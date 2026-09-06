import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as fxGet } from "./fx-refresh/route";
import { GET as genGet } from "./generate-bill-instances/route";
import { GET as purgeGet } from "./purge-households/route";
import { GET as remindersGet } from "./send-bill-reminders/route";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseRouteHandler: vi.fn() }));
vi.mock("@/lib/bill-instances", () => ({ generateAllInstances: vi.fn() }));
vi.mock("@/lib/cron/purge-households", () => ({
  runPurgeHouseholds: vi.fn(),
  PURGE_SANITY_CAP: 50,
  PurgeSanityCapError: class extends Error {},
}));
vi.mock("@/lib/cron/send-bill-reminders", () => ({ runSendBillReminders: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.CRON_DISABLED;
});

describe("cron auth — production must not accept spoofed User-Agent", () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.CRON_DISABLED;
  });

  it("fx-refresh rejects vercel-cron UA in production when no secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await fxGet(
      new Request("http://localhost/api/cron/fx-refresh", {
        headers: { "user-agent": "vercel-cron/1.0" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("fx-refresh still allows vercel-cron UA in non-production when no secret", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EXCHANGERATE_API_KEY", "test-key");
    // Mock supabase + provider so the handler can succeed after auth
    const { createSupabaseRouteHandler } = await import("@/lib/supabase/server");
    const fakeClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
      rpc: vi.fn((fn: string) => {
        if (fn === "claim_fx_refresh") return Promise.resolve({ data: true, error: null });
        if (fn === "record_fx_refresh_success") return Promise.resolve({ data: true, error: null });
        return Promise.resolve({ data: null, error: null });
      }),
    };
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue(fakeClient as never);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ result: "success", conversion_rates: { USD: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const res = await fxGet(
      new Request("http://localhost/api/cron/fx-refresh", {
        headers: { "user-agent": "vercel-cron/1.0" },
      }),
    );
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it("generate-bill-instances rejects vercel-cron UA in production and in dev (no fallback)", async () => {
    for (const env of ["production", "development"] as const) {
      vi.stubEnv("NODE_ENV", env);
      const res = await genGet(
        new Request("http://localhost/api/cron/generate-bill-instances", {
          headers: { "user-agent": "vercel-cron/1.0" },
        }),
      );
      expect(res.status).toBe(401);
    }
  });

  it("purge-households (destructive) rejects vercel-cron UA in production and in dev", async () => {
    for (const env of ["production", "development"] as const) {
      vi.stubEnv("NODE_ENV", env);
      const res = await purgeGet(
        new Request("http://localhost/api/cron/purge-households", {
          headers: { "user-agent": "vercel-cron/1.0" },
        }),
      );
      expect(res.status).toBe(401);
    }
  });

  it("send-bill-reminders rejects vercel-cron UA in production and in dev (no fallback)", async () => {
    for (const env of ["production", "development"] as const) {
      vi.stubEnv("NODE_ENV", env);
      const res = await remindersGet(
        new Request("http://localhost/api/cron/send-bill-reminders", {
          headers: { "user-agent": "vercel-cron/1.0" },
        }),
      );
      expect(res.status).toBe(401);
    }
  });

  it("all crons reject unauthenticated bearer with wrong secret in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.CRON_SECRET = "real-secret";
    for (const handler of [fxGet, genGet, purgeGet, remindersGet]) {
      const res = await handler(
        new Request("http://localhost/api/cron/test", {
          headers: { authorization: "Bearer wrong", "user-agent": "vercel-cron/1.0" },
        }),
      );
      expect(res.status).toBe(401);
    }
  });

  it("all crons reject plain unauthenticated request in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.CRON_SECRET = "real-secret";
    for (const handler of [fxGet, genGet, purgeGet, remindersGet]) {
      const res = await handler(new Request("http://localhost/api/cron/test"));
      expect(res.status).toBe(401);
    }
  });
});
