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

const confirmed = {
  id: "req-1",
  status: "confirmed",
  requested_at: "2026-09-29T00:00:00Z",
  confirmed_at: "2026-09-29T01:00:00Z",
  scheduled_purge_at: "2026-10-29T01:00:00Z",
  purged_at: null,
};

function request(body: unknown) {
  return new Request("http://localhost/api/account/deletion-confirm", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makeClient(opts: { pending?: { id: string } | null }) {
  vi.mocked(createRouteContext).mockResolvedValue({} as never);
  const pendingMaybe = vi.fn().mockResolvedValue({ data: opts.pending ?? null, error: null });
  const confirmSingle = vi.fn().mockResolvedValue({ data: confirmed, error: null });
  const adminFrom = vi.fn((table: string) => {
    if (table === "account_deletion_requests") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: pendingMaybe })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({ select: vi.fn(() => ({ single: confirmSingle })) })),
        })),
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
  return { adminFrom, pendingMaybe, confirmSingle };
}

function auth(email: string | null) {
  vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1", email } as never);
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

describe("POST /api/account/deletion-confirm", () => {
  it("rejects unauthenticated callers", async () => {
    makeClient({ pending: { id: "req-1" } });
    vi.mocked(getAuthedUser).mockRejectedValue(new HttpError(401, "authentication required"));

    expect((await POST(request({ email: "a@b.c" }))).status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    makeClient({ pending: { id: "req-1" } });
    auth("user@example.com");

    expect((await POST(request({}))).status).toBe(400);
  });

  it("rejects a non-matching confirmation email", async () => {
    const client = makeClient({ pending: { id: "req-1" } });
    auth("user@example.com");

    const res = await POST(request({ email: "someone-else@example.com" }));

    expect(res.status).toBe(400);
    expect(client.pendingMaybe).not.toHaveBeenCalled();
  });

  it("returns 404 without a pending request", async () => {
    makeClient({ pending: null });
    auth("user@example.com");

    const res = await POST(request({ email: "user@example.com" }));

    expect(res.status).toBe(404);
  });

  it("confirms and starts the grace clock (case-insensitive email)", async () => {
    const client = makeClient({ pending: { id: "req-1" } });
    auth("user@example.com");

    const res = await POST(request({ email: "USER@example.com" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ request: confirmed });
    expect(client.confirmSingle).toHaveBeenCalledOnce();
  });
});
