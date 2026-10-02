import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_FORBIDDEN_KEYS,
  ADMIN_METRIC_ACTIVATION_KEYS,
  ADMIN_METRIC_ARTICLE_KEYS,
  ADMIN_METRIC_FUNNEL_KEYS,
  ADMIN_METRIC_RETENTION_KEYS,
  ADMIN_METRIC_SOURCE_KEYS,
  ADMIN_METRIC_SUBSCRIPTION_KEYS,
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

type RpcPreset = Record<string, Array<Record<string, unknown>>>;

function fakeDb(preset: RpcPreset) {
  return {
    rpc: async (fn: string, args?: unknown) => {
      void args;
      return { data: preset[fn] ?? [], error: null };
    },
  };
}

const preset = (): RpcPreset => ({
  admin_metrics_activation: [
    {
      signed_up_users: 23,
      active_households: 18,
      setup_complete: 8,
      budget_created: 4,
      partner_joined: 2,
      setup_and_partner_joined: 2,
    },
  ],
  admin_metrics_funnel: [
    { step: 1, name: "1 — Signed up", reached: 20, lost_at_step: 0 },
    { step: 8, name: "8 — Partner accepted", reached: 2, lost_at_step: 1 },
  ],
  admin_metrics_retention: [
    {
      cohort_week: "2026-09-07T00:00:00Z",
      households: 5,
      week_2_active: 3,
      week_2_eligible: 5,
      week_3_active: 0,
      week_3_eligible: 0,
      week_4_active: 0,
      week_4_eligible: 0,
    },
  ],
  admin_metrics_content_articles: [
    {
      slug: "art-1",
      views: 10,
      readers: 7,
      d25: 5,
      d50: 4,
      d75: 3,
      d100: 2,
      // Smuggled identity/content columns must never reach the wire (#275
      // AC2: aggregates only, no per-user reading history).
      user_id: "99999999-9999-9999-9999-999999999999",
      email: "reader@test.local",
    },
  ],
  admin_metrics_content_sources: [{ src: "guide-view", cnt: 10 }],
  admin_metrics_subscriptions: [{ plan_code: "plus", status: "active", households: 12 }],
});

function wireHasForbidden(body: unknown) {
  const wire = JSON.stringify(body);
  for (const key of ADMIN_FORBIDDEN_KEYS) {
    expect(wire, `wire body must not contain ${key}`).not.toContain(`"${key}"`);
  }
  expect(wire).not.toContain("user_id");
  expect(wire).not.toContain("household_id");
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.BUILD_TARGET;
  delete process.env.BILLING_ENABLED;
  delete process.env.NEXT_PUBLIC_BILLING_ENABLED;
});

describe("GET /api/admin/metrics (#275)", () => {
  it("returns neutral 404 for non-admins", async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/admin/metrics"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("returns every allowlisted section and audits the view", async () => {
    const db = fakeDb(preset());
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);
    const res = await GET(new Request("http://localhost/api/admin/metrics"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const body = (await res.json()) as {
      activation: Record<string, unknown>;
      funnel: Array<Record<string, unknown>>;
      retention: Array<Record<string, unknown>>;
      contentArticles: Array<Record<string, unknown>>;
      contentSources: Array<Record<string, unknown>>;
      subscriptions: Array<Record<string, unknown>>;
    };
    expect(Object.keys(body.activation).sort()).toEqual([...ADMIN_METRIC_ACTIVATION_KEYS].sort());
    expect(body.activation).toMatchObject({ active_households: 18, setup_complete: 8 });
    expect(Object.keys(body.funnel[0]!).sort()).toEqual([...ADMIN_METRIC_FUNNEL_KEYS].sort());
    expect(Object.keys(body.retention[0]!).sort()).toEqual([...ADMIN_METRIC_RETENTION_KEYS].sort());
    expect(Object.keys(body.contentArticles[0]!).sort()).toEqual(
      [...ADMIN_METRIC_ARTICLE_KEYS].sort(),
    );
    expect(Object.keys(body.contentSources[0]!).sort()).toEqual(
      [...ADMIN_METRIC_SOURCE_KEYS].sort(),
    );
    expect(Object.keys(body.subscriptions[0]!).sort()).toEqual(
      [...ADMIN_METRIC_SUBSCRIPTION_KEYS].sort(),
    );

    wireHasForbidden(body);
    expect(mockAudit).toHaveBeenCalledWith(db, "metrics.view", null);
  });

  it("omits revenue while billing is disabled and shows it once live", async () => {
    const db = fakeDb(preset());
    mockRequireAdmin.mockResolvedValue({ db: db as never, userId: "u-admin" } as never);

    process.env.BILLING_ENABLED = "";
    const off = await GET(new Request("http://localhost/api/admin/metrics"));
    expect(off.status).toBe(200);
    expect(await off.json()).not.toHaveProperty("revenue");

    process.env.BILLING_ENABLED = "1";
    const on = await GET(new Request("http://localhost/api/admin/metrics"));
    expect(on.status).toBe(200);
    const body = (await on.json()) as { revenue: { enabled: boolean; rows: unknown[] } };
    expect(body.revenue.enabled).toBe(true);
    expect(body.revenue.rows).toEqual([]);
  });

  it("is unavailable in the Tauri bundle", async () => {
    process.env.BUILD_TARGET = "tauri";
    const res = await GET(new Request("http://localhost/api/admin/metrics"));
    expect(res.status).toBe(404);
  });
});
