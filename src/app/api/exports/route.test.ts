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
import { POST } from "./route";

const householdId = "10000000-0000-4000-8000-000000000001";
const token = "a".repeat(64);

function request(body: unknown) {
  return new Request("http://localhost/api/exports", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makeClient(opts: {
  member?: { id: string; household_id: string } | null;
  entitled?: boolean;
  link?: { token: string; expires_at: string; format: string } | null;
  insertError?: { message: string; code?: string } | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: opts.member ?? null, error: null });
  const membershipChain = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({ is: vi.fn(() => ({ maybeSingle })) })),
      })),
    })),
  };
  const rpc = vi.fn().mockResolvedValue({ data: opts.entitled ?? true, error: null });
  const insertSingle = vi.fn().mockResolvedValue({
    data: opts.link ?? null,
    error: opts.insertError ?? null,
  });
  const insert = vi.fn(() => ({ select: vi.fn(() => ({ single: insertSingle })) }));
  const from = vi.fn((table: string) => {
    if (table === "household_members") return membershipChain;
    if (table === "data_export_links") return { insert };
    throw new Error(`unexpected table ${table}`);
  });
  return { from, rpc, insert, insertSingle, maybeSingle };
}

beforeEach(() => {
  vi.mocked(createRouteContext).mockReset();
  vi.mocked(getAuthedUser).mockReset();
  delete process.env.BUILD_TARGET;
});

afterEach(() => {
  delete process.env.BUILD_TARGET;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/exports", () => {
  it("rejects unauthenticated callers", async () => {
    vi.mocked(createRouteContext).mockResolvedValue({} as never);
    vi.mocked(getAuthedUser).mockRejectedValue(new HttpError(401, "authentication required"));

    const res = await POST(request({ householdId }));

    expect(res.status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    const client = makeClient({ member: { id: "m-1", household_id: householdId } });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request({ householdId: "not-a-uuid" }));

    expect(res.status).toBe(400);
    expect(client.insert).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not a member of the household", async () => {
    const client = makeClient({ member: null });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request({ householdId }));

    expect(res.status).toBe(403);
    expect(client.insert).not.toHaveBeenCalled();
  });

  it("returns 402 when the plan lacks export", async () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "1");
    const client = makeClient({
      member: { id: "m-1", household_id: householdId },
      entitled: false,
    });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request({ householdId }));

    expect(res.status).toBe(402);
    expect(client.insert).not.toHaveBeenCalled();
  });

  it("mints a link with token, expiry, and url", async () => {
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const client = makeClient({
      member: { id: "m-1", household_id: householdId },
      link: { token, expires_at, format: "json" },
    });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request({ householdId }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.expires_at).toBe(expires_at);
    expect(body.url).toContain(`/api/exports/${token}`);
    expect(body.expires_in_hours).toBe(24);
  });

  it("still mints when the audit write is unavailable", async () => {
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const client = makeClient({
      member: { id: "m-1", household_id: householdId },
      link: { token, expires_at, format: "csv" },
    });
    vi.mocked(createRouteContext).mockResolvedValue(client as never);
    vi.mocked(getAuthedUser).mockResolvedValue({ id: "user-1" } as never);

    const res = await POST(request({ householdId, format: "csv" }));

    expect(res.status).toBe(201);
  });
});
