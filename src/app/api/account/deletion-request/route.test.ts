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

const created = {
  id: "req-1",
  status: "pending",
  requested_at: "2026-09-29T00:00:00Z",
  confirmed_at: null,
  scheduled_purge_at: null,
  purged_at: null,
};

// Writes are route-only: the request table is touched through the service
// role (explicitly scoped to the caller), never the auth client.
function makeClient(opts: {
  open?: { id: string; status: string } | null;
  created?: typeof created | null;
  insertError?: { message: string; code: string } | null;
}) {
  vi.mocked(createRouteContext).mockResolvedValue({} as never);
  const openMaybe = vi.fn().mockResolvedValue({ data: opts.open ?? null, error: null });
  const createSingle = vi.fn().mockResolvedValue({
    data: opts.created ?? null,
    error: opts.insertError ?? null,
  });
  const selectEq = vi.fn(() => ({ in: vi.fn(() => ({ maybeSingle: openMaybe })) }));
  const adminFrom = vi.fn((table: string) => {
    if (table === "account_deletion_requests") {
      return {
        select: vi.fn(() => ({ eq: selectEq })),
        insert: vi.fn(() => ({ select: vi.fn(() => ({ single: createSingle })) })),
      };
    }
    if (table === "household_members" || table === "deletion_audit_log") {
      return {
        select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({ from: adminFrom } as never);
  return { adminFrom, openMaybe, createSingle };
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

describe("POST /api/account/deletion-request", () => {
  it("rejects unauthenticated callers", async () => {
    makeClient({ open: null });
    vi.mocked(getAuthedUser).mockRejectedValue(new HttpError(401, "authentication required"));

    expect((await POST()).status).toBe(401);
  });

  it("returns 409 when a request is already open", async () => {
    makeClient({ open: { id: "req-0", status: "confirmed" } });
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST();

    expect(res.status).toBe(409);
  });

  it("creates a pending request", async () => {
    makeClient({ open: null, created });
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST();

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ request: created });
  });

  it("maps a concurrent-insert race to 409", async () => {
    makeClient({
      open: null,
      insertError: { message: "duplicate key value", code: "23505" },
    });
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST();

    expect(res.status).toBe(409);
  });
});
