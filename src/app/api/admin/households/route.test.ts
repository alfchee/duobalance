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
import { GET } from "./route";

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockAudit = vi.mocked(auditAdminAction);

const HH_ID = "11111111-1111-1111-1111-111111111111";
const SUB_ID = "33333333-3333-3333-3333-333333333333";

/** Minimal PostgREST-chain emulator: modifiers return the chain, awaiting resolves { data, error }. */
function fakeAdmin(preset: Record<string, Array<Record<string, unknown>>>) {
  const makeChain = (table: string) => {
    const rows = preset[table] ?? [];
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.order = () => chain;
    chain.range = () => chain;
    chain.or = () => chain;
    chain.eq = () => chain;
    chain.in = () => chain;
    chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    chain.then = (resolve: (v: unknown) => void) =>
      resolve({ data: rows, count: rows.length, error: null });
    return chain;
  };
  return { from: (table: string) => makeChain(table) };
}

const listPreset = () => ({
  households: [{ id: HH_ID, name: "House A", country: "CL", created_at: "2026-01-01T00:00:00Z" }],
  subscriptions: [
    { household_id: HH_ID, plan_code: "comped", status: "active", current_period_end: null },
  ],
  household_members: [{ household_id: HH_ID }],
  accounts: [{ household_id: HH_ID }, { household_id: HH_ID }],
  transactions: [{ household_id: HH_ID }, { household_id: HH_ID }, { household_id: HH_ID }],
});

const detailPreset = () => ({
  households: [{ id: HH_ID, name: "House B", country: "NI", created_at: "2026-02-01T00:00:00Z" }],
  subscriptions: [
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
  household_members: [{ household_id: HH_ID }, { household_id: HH_ID }],
  accounts: [{ household_id: HH_ID }],
  transactions: [
    { household_id: HH_ID },
    { household_id: HH_ID },
    { household_id: HH_ID },
    { household_id: HH_ID },
    { household_id: HH_ID },
  ],
  billing_events: [
    {
      id: "44444444-4444-4444-4444-444444444444",
      provider: "stub",
      provider_event_id: "evt-1",
      subscription_id: SUB_ID,
      type: "subscription.activated",
      received_at: "2026-02-01T00:00:00Z",
      processed_at: "2026-02-01T00:00:01Z",
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

  it("returns neutral 404 for an unknown status filter (no hint)", async () => {
    mockRequireAdmin.mockResolvedValue({ admin: fakeAdmin({}) as never, userId: "u" } as never);
    const res = await GET(new Request("http://localhost/api/admin/households?status=vip"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("returns counts only, flags comped, audits, and hardens headers", async () => {
    const admin = fakeAdmin(listPreset());
    mockRequireAdmin.mockResolvedValue({ admin: admin as never, userId: "u-admin" } as never);
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
    });
    wireHasForbidden(body);
    expect(mockAudit).toHaveBeenCalledWith(admin, "u-admin", "households.list", null);
  });

  it("is unavailable in the Tauri bundle", async () => {
    process.env.BUILD_TARGET = "tauri";
    const res = await GET(new Request("http://localhost/api/admin/households"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/households?id= — detail (#271)", () => {
  it("returns neutral 404 for malformed ids and unknown households alike", async () => {
    const admin = fakeAdmin({ households: [] });
    mockRequireAdmin.mockResolvedValue({ admin: admin as never, userId: "u-admin" } as never);
    const bad = await GET(new Request("http://localhost/api/admin/households?id=not-a-uuid"));
    expect(bad.status).toBe(404);
    const missing = await GET(new Request(`http://localhost/api/admin/households?id=${HH_ID}`));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not found" });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("returns the allowlisted detail with full history and audits the view", async () => {
    const admin = fakeAdmin(detailPreset());
    mockRequireAdmin.mockResolvedValue({ admin: admin as never, userId: "u-admin" } as never);
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
    });
    expect(body.subscriptions).toHaveLength(1);
    expect(Object.keys(body.subscriptions[0]!).sort()).toEqual([...ADMIN_SUBSCRIPTION_KEYS].sort());
    expect(body.billingEvents).toHaveLength(1);
    expect(Object.keys(body.billingEvents[0]!).sort()).toEqual(
      [...ADMIN_BILLING_EVENT_KEYS].sort(),
    );

    wireHasForbidden(body);
    expect(mockAudit).toHaveBeenCalledWith(admin, "u-admin", "households.view", HH_ID);
  });
});
