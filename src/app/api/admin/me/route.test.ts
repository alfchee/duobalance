import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_shared")>()),
  requireAdmin: vi.fn(),
  auditAdminAction: vi.fn(),
}));

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
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("confirms rostered admins and audits the check", async () => {
    const admin = {};
    mockRequireAdmin.mockResolvedValue({ admin: admin as never, userId: "u-admin" } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isAdmin: true });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(mockAudit).toHaveBeenCalledWith(admin, "u-admin", "me.check", null);
  });
});
