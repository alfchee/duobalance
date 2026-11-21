import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_COUPON_KEYS,
  ADMIN_COUPON_REDEMPTION_KEYS,
  ADMIN_FORBIDDEN_KEYS,
} from "@/lib/admin/scope";

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
import { GET, POST } from "./route";

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockAudit = vi.mocked(auditAdminAction);

type RpcPreset = Record<string, Array<Record<string, unknown>>>;

/** Caller-scoped RPC emulator: resolves per-function canned rows. */
function fakeDb(preset: RpcPreset, calls: Array<{ fn: string; args: unknown }> = []) {
  return {
    calls,
    rpc: async (fn: string, args?: unknown) => {
      calls.push({ fn, args });
      return { data: preset[fn] ?? [], error: null };
    },
  };
}

const couponRow = () => ({
  code: "BLOG20",
  discount_type: "percent",
  discount_value: 20,
  currency: null,
  valid_from: "2026-09-01T00:00:00Z",
  valid_until: "2026-12-31T00:00:00Z",
  max_redemptions: 500,
  per_household_limit: 1,
  duration: "lifetime",
  active: true,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  redemption_count: 3,
  remaining_capacity: 497,
  // A future widened function output must still not leak: the route
  // projects through the allowlist (defense in depth). Smuggle the full
  // forbidden vocabulary here so the wire assertion pins #274 AC5
  // (identifiers, not personal data).
  email: "owner@test.local",
  display_name: "Secret Owner",
  description: "Secret campaign",
  amount: 999,
  merchant: "Secret store",
  notes: "Secret note",
  category: "Secret",
  account_name: "Secret account",
  opening_balance: 1,
  payload: { secret: true },
});

const redemptionRow = () => ({
  coupon_code: "BLOG20",
  household_id: "11111111-1111-1111-1111-111111111111",
  redeemed_at: "2026-09-10T00:00:00Z",
  email: "owner@test.local",
});

function wireHasForbidden(body: unknown) {
  const wire = JSON.stringify(body);
  for (const key of ADMIN_FORBIDDEN_KEYS) {
    expect(wire, `wire body must not contain ${key}`).not.toContain(`"${key}"`);
  }
}

function postReq(body: unknown) {
  return new Request("http://localhost/api/admin/coupons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const createBody = () => ({
  action: "create",
  code: "BLOG20",
  discount_type: "percent",
  discount_value: 20,
  currency: null,
  valid_from: "2026-09-01T00:00:00Z",
  valid_until: "2026-12-31T00:00:00Z",
  max_redemptions: 500,
  per_household_limit: 1,
  duration: "lifetime",
  reason: "blogger campaign, ticket 1",
});

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.BUILD_TARGET;
});

describe("GET /api/admin/coupons — list (#274)", () => {
  it("returns neutral 404 for non-admins", async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/admin/coupons"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("lists coupons through the allowlist with live counts", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const db = fakeDb({ admin_list_coupons: [couponRow()] }, calls);
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await GET(new Request("http://localhost/api/admin/coupons"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const body = (await res.json()) as {
      coupons: Array<Record<string, unknown>>;
      limit: number;
      offset: number;
    };
    expect(body.coupons).toHaveLength(1);
    expect(body).toMatchObject({ limit: 100, offset: 0 });
    expect(calls).toContainEqual({ fn: "admin_list_coupons", args: { p_limit: 100, p_offset: 0 } });
    expect(Object.keys(body.coupons[0]!).sort()).toEqual([...ADMIN_COUPON_KEYS].sort());
    expect(body.coupons[0]).toMatchObject({
      code: "BLOG20",
      redemption_count: 3,
      remaining_capacity: 497,
    });
    wireHasForbidden(body);
    expect(mockAudit).toHaveBeenCalledWith(db, "coupons.list", null);
  });

  it("pages the list through limit/offset (clamped)", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const db = fakeDb({ admin_list_coupons: [] }, calls);
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await GET(new Request("http://localhost/api/admin/coupons?limit=5&offset=10"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { limit: number; offset: number };
    expect(body).toMatchObject({ limit: 5, offset: 10 });
    expect(calls).toContainEqual({ fn: "admin_list_coupons", args: { p_limit: 5, p_offset: 10 } });

    const wild = await GET(new Request("http://localhost/api/admin/coupons?limit=9999&offset=-3"));
    const wildBody = (await wild.json()) as { limit: number; offset: number };
    expect(wildBody).toMatchObject({ limit: 500, offset: 0 });
  });

  it("is unavailable in the Tauri bundle", async () => {
    process.env.BUILD_TARGET = "tauri";
    const res = await GET(new Request("http://localhost/api/admin/coupons"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/coupons?code= — redemptions (#274)", () => {
  it("returns the coupon with identifier-only redemptions", async () => {
    const db = fakeDb({
      admin_get_coupon: [couponRow()],
      admin_get_coupon_redemptions: [redemptionRow()],
    });
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await GET(new Request("http://localhost/api/admin/coupons?code=BLOG20"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      coupon: Record<string, unknown>;
      redemptions: Array<Record<string, unknown>>;
      redemptions_limit: number;
      redemptions_offset: number;
    };
    expect(Object.keys(body.coupon).sort()).toEqual([...ADMIN_COUPON_KEYS].sort());
    expect(body.redemptions).toHaveLength(1);
    expect(body).toMatchObject({ redemptions_limit: 100, redemptions_offset: 0 });
    expect(Object.keys(body.redemptions[0]!).sort()).toEqual(
      [...ADMIN_COUPON_REDEMPTION_KEYS].sort(),
    );
    expect(body.redemptions[0]).toMatchObject({
      coupon_code: "BLOG20",
      household_id: "11111111-1111-1111-1111-111111111111",
    });
    wireHasForbidden(body);
    expect(mockAudit).toHaveBeenCalledWith(db, "coupon.redemptions.view", null);
  });

  it("matches codes case-insensitively and 404s neutrally when unknown", async () => {
    const found = fakeDb({
      admin_get_coupon: [couponRow()],
      admin_get_coupon_redemptions: [],
    });
    mockRequireAdmin.mockResolvedValue({ db: found as never, userId: "u-admin" } as never);
    const lower = await GET(new Request("http://localhost/api/admin/coupons?code=blog20"));
    expect(lower.status).toBe(200);

    const empty = fakeDb({ admin_get_coupon: [], admin_get_coupon_redemptions: [] });
    mockRequireAdmin.mockResolvedValue({ db: empty as never, userId: "u-admin" } as never);
    const missing = await GET(new Request("http://localhost/api/admin/coupons?code=NOPE99"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not found" });
  });
});

describe("POST /api/admin/coupons — create + set_active (#274)", () => {
  it("returns neutral 404 for non-admins", async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await POST(postReq(createBody()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("rejects bodies with missing constraints or reasons", async () => {
    const db = fakeDb({ admin_list_coupons: [couponRow()] });
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const { currency: _omitted, ...noCurrencyKey } = createBody();
    void _omitted;
    for (const body of [
      { ...createBody(), reason: "x" },
      noCurrencyKey, // currency key omitted: silent default, rejected
      { ...createBody(), valid_from: "not-a-date" },
      { action: "set_active", code: "BLOG20", active: true },
      { action: "freeze", code: "BLOG20", reason: "ticket 2" },
    ]) {
      const res = await POST(postReq(body));
      expect(res.status).toBe(400);
    }
  });

  it("creates with every constraint forwarded and returns the live row", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const db = fakeDb({ admin_create_coupon: [{}], admin_get_coupon: [couponRow()] }, calls);
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await POST(postReq(createBody()));
    expect(res.status).toBe(200);

    const createCall = calls.find((c) => c.fn === "admin_create_coupon");
    expect(createCall!.args).toMatchObject({
      p_code: "BLOG20",
      p_discount_type: "percent",
      p_discount_value: 20,
      p_currency: null,
      p_max_redemptions: 500,
      p_per_household_limit: 1,
      p_duration: "lifetime",
      p_reason: "blogger campaign, ticket 1",
    });

    const body = (await res.json()) as {
      coupon: Record<string, unknown>;
      idempotent: boolean;
    };
    expect(Object.keys(body.coupon).sort()).toEqual([...ADMIN_COUPON_KEYS].sort());
    expect(body.coupon).toMatchObject({ code: "BLOG20", remaining_capacity: 497 });
    expect(body.idempotent).toBe(false);
    wireHasForbidden(body);
  });

  it("maps duplicates to 409 and validation failures to 400", async () => {
    const coded = (code: string, message: string) => ({
      rpc: async (fn: string, args?: unknown) => {
        void args;
        if (fn === "admin_create_coupon") return { data: null, error: { code, message } };
        return { data: [couponRow()], error: null };
      },
    });
    const attempt = (db: unknown) => {
      mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
      return POST(postReq(createBody()));
    };

    // Redelivered create: 409, never a second row.
    const dupe = await attempt(coded("23505", 'coupon code "BLOG20" already exists'));
    expect(dupe.status).toBe(409);

    const bad = await attempt(coded("23514", "percent discount must be 1-100"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "percent discount must be 1-100" });
  });

  it("maps unknown codes to the neutral 404 like unknown households", async () => {
    const db = {
      rpc: async (fn: string) => {
        if (fn === "admin_set_coupon_active") {
          return {
            data: null,
            error: { code: "23514", message: 'unknown coupon "NOPE99"' },
          };
        }
        return { data: [], error: null };
      },
    };
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await POST(
      postReq({ action: "set_active", code: "NOPE99", active: false, reason: "ticket 9" }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("deactivates with a reason and reports idempotency", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const db = fakeDb(
      {
        admin_set_coupon_active: [{ was_idempotent: true }],
        admin_get_coupon: [{ ...couponRow(), active: false }],
      },
      calls,
    );
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await POST(
      postReq({ action: "set_active", code: "BLOG20", active: false, reason: "abuse wave" }),
    );
    expect(res.status).toBe(200);

    const flagCall = calls.find((c) => c.fn === "admin_set_coupon_active");
    expect(flagCall!.args).toMatchObject({
      p_code: "BLOG20",
      p_active: false,
      p_reason: "abuse wave",
    });

    const body = (await res.json()) as {
      coupon: Record<string, unknown>;
      idempotent: boolean;
    };
    expect(body.coupon).toMatchObject({ code: "BLOG20", active: false });
    expect(body.idempotent).toBe(true);
    wireHasForbidden(body);
  });

  it("reports idempotent:false on an empty set_active shape (never vacuous true)", async () => {
    const db = fakeDb(
      {
        admin_set_coupon_active: [],
        admin_get_coupon: [{ ...couponRow(), active: false }],
      },
      [],
    );
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await POST(
      postReq({ action: "set_active", code: "BLOG20", active: false, reason: "abuse wave" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      coupon: Record<string, unknown>;
      idempotent: boolean;
    };
    expect(body.idempotent).toBe(false);
  });

  it("is unavailable in the Tauri bundle", async () => {
    process.env.BUILD_TARGET = "tauri";
    const res = await POST(postReq(createBody()));
    expect(res.status).toBe(404);
  });
});
