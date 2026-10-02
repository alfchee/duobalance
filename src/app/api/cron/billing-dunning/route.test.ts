import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/cron/send-dunning-emails", () => ({ runSendDunningEmails: vi.fn() }));

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { runSendDunningEmails } from "@/lib/cron/send-dunning-emails";

function authed(path: string): Request {
  return new Request(path, { headers: { authorization: "Bearer test-secret" } });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  delete process.env.CRON_DISABLED;
  vi.stubEnv("BILLING_ENABLED", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.BILLING_ENABLED;
  delete process.env.NEXT_PUBLIC_BILLING_ENABLED;
  delete process.env.CRON_SECRET;
  delete process.env.CRON_DISABLED;
  vi.clearAllMocks();
});

describe("/api/cron/billing-dunning (#265)", () => {
  it("no-ops with 200 when CRON_DISABLED is set", async () => {
    process.env.CRON_DISABLED = "true";
    const res = await GET(authed("http://localhost/api/cron/billing-dunning"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disabled: true, job: "billing-dunning" });
    expect(runSendDunningEmails).not.toHaveBeenCalled();
  });

  it("returns 404 — not 500 — when billing is off", async () => {
    vi.stubEnv("BILLING_ENABLED", "0");
    const res = await POST(authed("http://localhost/api/cron/billing-dunning"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(runSendDunningEmails).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated calls", async () => {
    const res = await GET(new Request("http://localhost/api/cron/billing-dunning"));
    expect(res.status).toBe(401);
  });

  it("runs the job and reports the sweep", async () => {
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({} as never);
    vi.mocked(runSendDunningEmails).mockResolvedValue({
      checked: 2,
      sent: [{ subscriptionId: "s1", householdId: "h1", stage: "first_reminder" }],
      skipped: [],
    });
    const res = await POST(authed("http://localhost/api/cron/billing-dunning"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      checked: 2,
      sent: [{ subscriptionId: "s1", householdId: "h1", stage: "first_reminder" }],
      skipped: [],
    });
  });

  it("maps a job failure to a retryable 502 without recording", async () => {
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({} as never);
    vi.mocked(runSendDunningEmails).mockRejectedValue(new Error("Resend down"));
    const res = await POST(authed("http://localhost/api/cron/billing-dunning"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "billing dunning failed" });
  });
});
