import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_BILLING_EVENT_KEYS,
  ADMIN_FORBIDDEN_KEYS,
  ADMIN_HOUSEHOLD_KEYS,
  ADMIN_SUBSCRIPTION_KEYS,
} from "@/lib/admin/scope";

vi.mock("../_shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_shared")>()),
  requireAdmin: vi.fn(),
  auditAdminAction: vi.fn(),
}));

import { auditAdminAction, requireAdmin } from "../_shared";
import { GET, POST } from "./route";

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockAudit = vi.mocked(auditAdminAction);

const HH_ID = "11111111-1111-1111-1111-111111111111";
const SUB_ID = "33333333-3333-3333-3333-333333333333";

/** Caller-scoped RPC emulator: resolves per-function canned rows. */
function fakeDb(
  preset: Record<string, Array<Record<string, unknown>>>,
  calls: Array<{ fn: string; args: unknown }> = [],
) {
  return {
    calls,
    rpc: async (fn: string, args?: unknown) => {
      calls.push({ fn, args });
      return { data: preset[fn] ?? [], error: null };
    },
  };
}

const listPreset = () => ({
  admin_list_households: [
    {
      household_id: HH_ID,
      household_name: "House A",
      country: "CL",
      created_at: "2026-01-01T00:00:00Z",
      last_activity: "2026-02-15T12:00:00Z",
      plan_code: "comped",
      subscription_status: "active",
      current_period_end: null,
      grace_ends_at: null,
      is_comped: true,
      member_count: 1,
      account_count: 2,
      transaction_count: 3,
      // A future widened function output must still not leak: the route
      // projects through the allowlist (defense in depth). Smuggle the
      // full forbidden vocabulary here so the wire assertion below pins
      // AC1 (#272: no view or API response returns descriptions, amounts,
      // categories or account names).
      description: "Secret groceries",
      amount: -2500,
      merchant: "Secret store",
      notes: "Secret note",
      category: "Groceries",
      category_id: "99999999-9999-9999-9999-999999999999",
      account_id: "88888888-8888-8888-8888-888888888888",
      account_name: "Shared checking",
      opening_balance: 1000,
      payload: { secret: true },
      email: "owner@test.local",
    },
  ],
});

const detailPreset = () => ({
  admin_get_household: [
    {
      household_id: HH_ID,
      household_name: "House B",
      country: "NI",
      created_at: "2026-02-01T00:00:00Z",
      last_activity: "2026-02-20T08:00:00Z",
      plan_code: "plus",
      subscription_status: "active",
      current_period_end: "2026-03-01T00:00:00Z",
      grace_ends_at: null,
      is_comped: false,
      member_count: 2,
      account_count: 1,
      transaction_count: 5,
    },
  ],
  admin_get_subscription_history: [
    {
      id: SUB_ID,
      plan_code: "plus",
      provider: "stub",
      status: "active",
      trial_ends_at: null,
      current_period_end: "2026-03-01T00:00:00Z",
      grace_ends_at: null,
      created_at: "2026-02-01T00:00:00Z",
      updated_at: "2026-02-01T00:00:00Z",
    },
  ],
  admin_get_billing_events: [
    {
      id: "44444444-4444-4444-4444-444444444444",
      provider: "stub",
      provider_event_id: "evt-1",
      subscription_id: SUB_ID,
      type: "subscription.activated",
      received_at: "2026-02-01T00:00:00Z",
      processed_at: "2026-02-01T00:00:01Z",
      // Smuggled provider payload must never reach the wire (#272 AC1).
      payload: { amount: 999, description: "Secret" },
    },
  ],
});

function wireHasForbidden(body: unknown) {
  const wire = JSON.stringify(body);
  for (const key of ADMIN_FORBIDDEN_KEYS) {
    expect(wire, `wire body must not contain ${key}`).not.toContain(`"${key}"`);
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.BUILD_TARGET;
});

describe("GET /api/admin/households — list (#271)", () => {
  it("returns neutral 404 for non-admins", async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/admin/households"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("reads through admin_list_households and projects the allowlist", async () => {
    const db = fakeDb(listPreset());
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await GET(new Request("http://localhost/api/admin/households"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");

    const body = (await res.json()) as { households: Array<Record<string, unknown>> };
    expect(body.households).toHaveLength(1);
    const row = body.households[0]!;
    expect(Object.keys(row).sort()).toEqual([...ADMIN_HOUSEHOLD_KEYS].sort());
    expect(row).toMatchObject({
      household_name: "House A",
      plan_code: "comped",
      subscription_status: "active",
      is_comped: true,
      member_count: 1,
      account_count: 2,
      transaction_count: 3,
      last_activity: "2026-02-15T12:00:00Z",
    });
    // The smuggled forbidden vocabulary never reaches the wire body (#272 AC1).
    wireHasForbidden(body);
    expect(mockAudit).toHaveBeenCalledWith(db, "households.list", null);
  });

  it("forwards search, status, and pagination to the reader (#272)", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const db = fakeDb(listPreset(), calls);
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await GET(
      new Request(
        "http://localhost/api/admin/households?search=owner%40test.local&status=comped&limit=50&offset=50",
      ),
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("admin_list_households");
    expect(calls[0]!.args).toMatchObject({
      p_search: "owner@test.local",
      p_status: "comped",
      p_limit: 50,
      p_offset: 50,
    });
  });

  it("is unavailable in the Tauri bundle", async () => {
    process.env.BUILD_TARGET = "tauri";
    const res = await GET(new Request("http://localhost/api/admin/households"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/households?id= — detail (#271)", () => {
  it("returns neutral 404 for malformed ids and unknown households alike", async () => {
    const db = fakeDb({ admin_get_household: [], admin_get_subscription_history: [] });
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const bad = await GET(new Request("http://localhost/api/admin/households?id=not-a-uuid"));
    expect(bad.status).toBe(404);
    const missing = await GET(new Request(`http://localhost/api/admin/households?id=${HH_ID}`));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not found" });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("returns the allowlisted detail with full history and audits the view", async () => {
    const db = fakeDb(detailPreset());
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await GET(new Request(`http://localhost/api/admin/households?id=${HH_ID}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const body = (await res.json()) as {
      household: Record<string, unknown>;
      subscriptions: Array<Record<string, unknown>>;
      billingEvents: Array<Record<string, unknown>>;
    };
    expect(Object.keys(body.household).sort()).toEqual([...ADMIN_HOUSEHOLD_KEYS].sort());
    expect(body.household).toMatchObject({
      household_name: "House B",
      plan_code: "plus",
      subscription_status: "active",
      is_comped: false,
      member_count: 2,
      account_count: 1,
      transaction_count: 5,
      last_activity: "2026-02-20T08:00:00Z",
    });
    expect(body.subscriptions).toHaveLength(1);
    expect(Object.keys(body.subscriptions[0]!).sort()).toEqual([...ADMIN_SUBSCRIPTION_KEYS].sort());
    expect(body.billingEvents).toHaveLength(1);
    expect(Object.keys(body.billingEvents[0]!).sort()).toEqual(
      [...ADMIN_BILLING_EVENT_KEYS].sort(),
    );

    wireHasForbidden(body);
    expect(mockAudit).toHaveBeenCalledWith(db, "households.view", HH_ID);
  });
});

const overridePreset = () => ({
  ...detailPreset(),
  admin_override_subscription: [
    {
      subscription_id: SUB_ID,
      plan_code: "comped",
      status: "active",
      trial_ends_at: null,
      current_period_end: null,
      grace_ends_at: null,
      updated_at: "2026-02-20T08:00:00Z",
      was_idempotent: false,
    },
  ],
});

function postReq(body: unknown) {
  return new Request("http://localhost/api/admin/households", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/households — plan overrides (#273)", () => {
  it("returns neutral 404 for non-admins", async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await POST(
      postReq({ household_id: HH_ID, action: "grant_comped", reason: "ticket 1" }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("rejects bodies without a recorded reason", async () => {
    const db = fakeDb(overridePreset());
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    for (const body of [
      { household_id: HH_ID, action: "grant_comped" },
      { household_id: HH_ID, action: "grant_comped", reason: "x" },
      { household_id: HH_ID, action: "mint_money", reason: "ticket 2" },
      { household_id: "not-a-uuid", action: "revoke", reason: "ticket 3", confirm: true },
    ]) {
      const res = await POST(postReq(body));
      expect(res.status).toBe(400);
    }
  });

  it("maps reason/confirm failures to 400 and one-live violations to 409", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const db = {
      calls,
      rpc: async (fn: string, args?: unknown) => {
        calls.push({ fn, args });
        if (fn === "admin_override_subscription") {
          return {
            data: null,
            error: { message: "household already holds a live subscription (active)" },
          };
        }
        return { data: [], error: null };
      },
    };
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const conflict = await POST(
      postReq({ household_id: HH_ID, action: "grant_comped", reason: "ticket 4" }),
    );
    expect(conflict.status).toBe(409);

    const db2 = {
      rpc: async (fn: string) => {
        if (fn === "admin_override_subscription") {
          return {
            data: null,
            error: { message: "revoking entitlement requires explicit confirmation" },
          };
        }
        return { data: [], error: null };
      },
    };
    mockRequireAdmin.mockResolvedValue({ db: db2 as never, userId: "u-admin" } as never);
    const bad = await POST(postReq({ household_id: HH_ID, action: "revoke", reason: "ticket 5" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: "revoking entitlement requires explicit confirmation",
    });

    const db3 = {
      rpc: async (fn: string) => {
        if (fn === "admin_override_subscription") {
          return {
            data: null,
            error: {
              message: "extend_trial needs a p_extend_to on or after the current trial end",
            },
          };
        }
        return { data: [], error: null };
      },
    };
    mockRequireAdmin.mockResolvedValue({ db: db3 as never, userId: "u-admin" } as never);
    const shorten = await POST(
      postReq({
        household_id: HH_ID,
        action: "extend_trial",
        extend_to: "2026-03-01T00:00:00.000Z",
        reason: "ticket 5b",
      }),
    );
    expect(shorten.status).toBe(400);
  });

  it("applies the override and returns the resulting allowlisted state", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const db = fakeDb(overridePreset(), calls);
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await POST(
      postReq({
        household_id: HH_ID,
        action: "grant_comped",
        reason: "founder comp, ticket 6",
        idempotency_key: "key-6",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const overrideCall = calls.find((c) => c.fn === "admin_override_subscription");
    expect(overrideCall!.args).toMatchObject({
      p_household: HH_ID,
      p_action: "grant_comped",
      p_reason: "founder comp, ticket 6",
      p_confirm: false,
      p_idempotency_key: "key-6",
    });

    const body = (await res.json()) as {
      household: Record<string, unknown>;
      subscriptions: Array<Record<string, unknown>>;
      billingEvents: Array<Record<string, unknown>>;
      idempotent: boolean;
    };
    expect(Object.keys(body.household).sort()).toEqual([...ADMIN_HOUSEHOLD_KEYS].sort());
    expect(Object.keys(body.subscriptions[0]!).sort()).toEqual([...ADMIN_SUBSCRIPTION_KEYS].sort());
    expect(Object.keys(body.billingEvents[0]!).sort()).toEqual(
      [...ADMIN_BILLING_EVENT_KEYS].sort(),
    );
    expect(body.idempotent).toBe(false);
    wireHasForbidden(body);
  });

  it("forwards extend_to as an ISO timestamp with confirm for revokes", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const db = {
      calls,
      rpc: async (fn: string, args?: unknown) => {
        calls.push({ fn, args });
        if (fn === "admin_override_subscription") {
          return { data: [], error: null };
        }
        const preset = overridePreset() as Record<string, Array<Record<string, unknown>>>;
        return { data: preset[fn] ?? [], error: null };
      },
    };
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await POST(
      postReq({
        household_id: HH_ID,
        action: "extend_trial",
        extend_to: "2026-04-01T00:00:00.000Z",
        reason: "trial extension, ticket 7",
      }),
    );
    expect(res.status).toBe(200);
    const overrideCall = calls.find((c) => c.fn === "admin_override_subscription");
    expect(overrideCall!.args).toMatchObject({
      p_action: "extend_trial",
      p_extend_to: "2026-04-01T00:00:00.000Z",
    });
    const body = (await res.json()) as { idempotent: boolean };
    // Revoke no-op shape (zero override rows) reads as idempotent.
    expect(body.idempotent).toBe(true);
  });

  it("is unavailable in the Tauri bundle", async () => {
    process.env.BUILD_TARGET = "tauri";
    const res = await POST(
      postReq({ household_id: HH_ID, action: "grant_comped", reason: "ticket 8" }),
    );
    expect(res.status).toBe(404);
  });
});
