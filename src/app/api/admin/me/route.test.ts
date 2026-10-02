import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_shared")>();
  const requireAdmin = vi.fn();
  return {
    ...actual,
    requireAdmin,
    auditAdminAction: vi.fn(),
    // withAdmin delegates to the mocked requireAdmin so per-test contexts flow through.
    withAdmin: async (request: Request, handler: (ctx: unknown, req: Request) => unknown) => {
      const ctx = await requireAdmin(request);
      if (!ctx) return actual.adminNotFound();
      return handler(ctx, request);
    },
  };
});

import { auditAdminAction, requireAdmin } from "../_shared";
import { GET } from "./route";

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockAudit = vi.mocked(auditAdminAction);

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.BUILD_TARGET;
});

describe("GET /api/admin/me (#271)", () => {
  it("returns neutral 404 for non-admins", async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/admin/me"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("confirms rostered admins and audits the check", async () => {
    const db = {};
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await GET(new Request("http://localhost/api/admin/me"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isAdmin: true });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(mockAudit).toHaveBeenCalledWith(db, "me.check", null);
  });
});
