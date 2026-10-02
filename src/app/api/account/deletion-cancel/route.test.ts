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

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createRouteContext, getAuthedUser, requireUser } from "@/app/api/_shared";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { POST } from "./route";

const cancelled = {
  id: "req-1",
  status: "cancelled",
  requested_at: "2026-09-29T00:00:00Z",
  confirmed_at: "2026-09-29T01:00:00Z",
  scheduled_purge_at: "2026-10-29T01:00:00Z",
  purged_at: null,
};

function makeClient(open: { id: string } | null) {
  const openMaybe = vi.fn().mockResolvedValue({ data: open, error: null });
  const cancelSingle = vi.fn().mockResolvedValue({ data: cancelled, error: null });
  // Request table via the service role (route-only writes); the status GET
  // below reads through the auth client (SELECT-own retained).
  const adminFrom = vi.fn((table: string) => {
    if (table !== "account_deletion_requests") {
      return {
        select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    }
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({ maybeSingle: openMaybe })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle: cancelSingle })) })),
        })),
      })),
    };
  });
  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ from: adminFrom } as never);
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
  return { adminFrom, authFrom, openMaybe, cancelSingle };
}

beforeEach(() => {
  vi.mocked(createRouteContext).mockReset();
  vi.mocked(getAuthedUser).mockReset();
  vi.mocked(requireUser).mockReset();
  vi.mocked(createSupabaseServiceRoleClient).mockReset();
  delete process.env.BUILD_TARGET;
});

afterEach(() => {
  delete process.env.BUILD_TARGET;
  vi.clearAllMocks();
});

describe("POST /api/account/deletion-cancel", () => {
  it("rejects unauthenticated callers", async () => {
    makeClient({ id: "req-1" });
    vi.mocked(requireUser).mockResolvedValue({
      response: Response.json({ error: "authentication required" }, { status: 401 }),
    });

    expect((await POST()).status).toBe(401);
  });

  it("returns 404 without an open request", async () => {
    makeClient(null);

    expect((await POST()).status).toBe(404);
  });

  it("cancels an open request", async () => {
    makeClient({ id: "req-1" });

    const res = await POST();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ request: cancelled });
  });

  it("returns 404 when a concurrent purge wins the race", async () => {
    // Read saw an open request, but the conditional write matched zero rows.
    const { cancelSingle } = makeClient({ id: "req-1" });
    cancelSingle.mockResolvedValue({ data: null, error: null });

    expect((await POST()).status).toBe(404);
  });
});
