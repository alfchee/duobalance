import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/_shared", () => ({
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  createRouteContext: vi.fn(),
  getAuthedUser: vi.fn(),
  requireUser: vi.fn(),
}));

import { createRouteContext, getAuthedUser, requireUser } from "@/app/api/_shared";
import { GET } from "./route";

function makeClient(open: { id: string; status: string } | null) {
  const openMaybe = vi.fn().mockResolvedValue({ data: open, error: null });
  const authFrom = vi.fn((table: string) => {
    if (table !== "account_deletion_requests") throw new Error(`unexpected table ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({ maybeSingle: openMaybe })),
        })),
      })),
    };
  });
  vi.mocked(createRouteContext).mockResolvedValue({ from: authFrom } as never);
  vi.mocked(requireUser).mockResolvedValue({
    supabase: { from: authFrom } as never,
    user: { id: "user-1" } as never,
  });
  return { authFrom, openMaybe };
}

beforeEach(() => {
  vi.mocked(createRouteContext).mockReset();
  vi.mocked(getAuthedUser).mockReset();
  vi.mocked(requireUser).mockReset();
  delete process.env.BUILD_TARGET;
});

afterEach(() => {
  delete process.env.BUILD_TARGET;
  vi.clearAllMocks();
});

describe("GET /api/account/deletion-status", () => {
  it("rejects unauthenticated callers", async () => {
    makeClient({ id: "req-1", status: "confirmed" });
    vi.mocked(requireUser).mockResolvedValue({
      response: Response.json({ error: "authentication required" }, { status: 401 }),
    });

    expect((await GET()).status).toBe(401);
  });

  it("returns null without an open request", async () => {
    makeClient(null);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ request: null });
  });

  it("returns the pending request", async () => {
    const open = { id: "req-1", status: "pending" };
    makeClient(open);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ request: open });
  });

  it("returns the confirmed request", async () => {
    const open = { id: "req-1", status: "confirmed" };
    makeClient(open);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ request: open });
  });
});
