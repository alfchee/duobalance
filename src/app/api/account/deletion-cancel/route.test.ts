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
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createRouteContext, getAuthedUser, HttpError } from "@/app/api/_shared";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { POST } from "./route";
import { GET } from "../deletion-status/route";

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
        eq: vi.fn(() => ({ select: vi.fn(() => ({ single: cancelSingle })) })),
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
  return { adminFrom, authFrom, openMaybe, cancelSingle };
}

beforeEach(() => {
  vi.mocked(createRouteContext).mockReset();
  vi.mocked(getAuthedUser).mockReset();
  vi.mocked(createSupabaseServiceRoleClient).mockReset();
  delete process.env.BUILD_TARGET;
});

afterEach(() => {
  delete process.env.BUILD_TARGET;
  vi.clearAllMocks();
});

describe("POST /api/account/deletion-cancel", () => {
  it("rejects unauthenticated callers", async () => {
    vi.mocked(createRouteContext).mockResolvedValue({} as never);
    vi.mocked(getAuthedUser).mockRejectedValue(new HttpError(401, "authentication required"));

    expect((await POST()).status).toBe(401);
  });

  it("returns 404 without an open request", async () => {
    makeClient(null);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    expect((await POST()).status).toBe(404);
  });

  it("cancels an open request", async () => {
    makeClient({ id: "req-1" });
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ request: cancelled });
  });
});

describe("GET /api/account/deletion-status", () => {
  it("rejects unauthenticated callers", async () => {
    vi.mocked(createRouteContext).mockResolvedValue({} as never);
    vi.mocked(getAuthedUser).mockRejectedValue(new HttpError(401, "authentication required"));

    expect((await GET()).status).toBe(401);
  });

  it("returns null without an open request", async () => {
    makeClient(null);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ request: null });
  });

  it("returns the open request", async () => {
    const open = { id: "req-1", status: "confirmed" };
    makeClient(open);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ request: open });
  });
});
