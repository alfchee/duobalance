import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These four routes all share the same CRON_DISABLED guard from lib/cron/guard.
// With CRON_DISABLED=true they must short-circuit before auth and before any
// Supabase call, returning 200 { disabled: true } with a log line. This test
// proves the rollback guard (Vercel keeps crons while Cloudflare is active).
import { GET as fxGet } from "./fx-refresh/route";
import { GET as genGet } from "./generate-bill-instances/route";
import { GET as purgeGet } from "./purge-households/route";
import { GET as remindersGet } from "./send-bill-reminders/route";

describe("CRON_DISABLED guard — all cron entry points no-op with 200", () => {
  beforeEach(() => {
    process.env.CRON_DISABLED = "true";
  });

  afterEach(() => {
    delete process.env.CRON_DISABLED;
    vi.restoreAllMocks();
  });

  it("fx-refresh no-ops when CRON_DISABLED", async () => {
    const res = await fxGet(new Request("http://localhost/api/cron/fx-refresh"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ disabled: true, job: "fx-refresh" });
  });

  it("generate-bill-instances no-ops when CRON_DISABLED", async () => {
    const res = await genGet(new Request("http://localhost/api/cron/generate-bill-instances"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      disabled: true,
      job: "generate-bill-instances",
    });
  });

  it("purge-households no-ops when CRON_DISABLED", async () => {
    const res = await purgeGet(new Request("http://localhost/api/cron/purge-households"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ disabled: true, job: "purge-households" });
  });

  it("send-bill-reminders no-ops when CRON_DISABLED", async () => {
    const res = await remindersGet(new Request("http://localhost/api/cron/send-bill-reminders"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ disabled: true, job: "send-bill-reminders" });
  });

  it("accepts CRON_DISABLED=1 as truthy", async () => {
    process.env.CRON_DISABLED = "1";
    const res = await fxGet(new Request("http://localhost/api/cron/fx-refresh"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ disabled: true, job: "fx-refresh" });
  });
});
