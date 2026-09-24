import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ManualClock } from "@/lib/billing/clock";
import { runSendDunningEmails } from "./send-dunning-emails";
import type { Database } from "@/lib/supabase/types";

vi.mock("@/lib/dunning-email", () => ({ sendDunningEmail: vi.fn() }));
import { sendDunningEmail } from "@/lib/dunning-email";

type Delivery = { subscription_id: string; household_id: string; stage: string; sent_at: string };

// Full-stack fake for the cron wiring: subscriptions, households, members,
// the get_user_emails_batch RPC, and the dunning_deliveries ledger.
function makeClient(state: {
  subs: Array<{
    id: string;
    household_id: string;
    plan_code: string;
    status: string;
    grace_ends_at: string | null;
  }>;
  deliveries: Delivery[];
}) {
  const from = (table: string) => {
    if (table === "subscriptions") {
      return {
        select: (_cols: string) => ({
          in: async (_col: string, values: unknown[]) => ({
            data: state.subs.filter((s) => (values as string[]).includes(s.status)),
            error: null,
          }),
        }),
      };
    }
    if (table === "households") {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _value: unknown) => ({
            maybeSingle: async () => ({ data: { name: "Casa Luna" }, error: null }),
          }),
        }),
      };
    }
    if (table === "household_members") {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _value: unknown) => ({
            is: (_col2: string, _value2: unknown) =>
              Promise.resolve({
                data: [{ id: "m1", user_id: "u1", display_name: "Ana" }],
                error: null,
              }),
          }),
        }),
      };
    }
    if (table === "dunning_deliveries") {
      return {
        select: (_cols: string) => ({
          in: async (_col: string, values: unknown[]) => ({
            data: state.deliveries.filter((d) => (values as string[]).includes(d.subscription_id)),
            error: null,
          }),
        }),
        insert: async (input: Delivery) => {
          const key = `${input.subscription_id}|${input.stage}`;
          if (state.deliveries.some((d) => `${d.subscription_id}|${d.stage}` === key)) {
            return { error: { code: "23505", message: "duplicate key" } };
          }
          state.deliveries.push({ ...input });
          return { error: null };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  };
  const rpc = async (name: string) => {
    if (name === "get_user_emails_batch") {
      return { data: [{ id: "u1", email: "ana@test.local" }], error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  return { from, rpc } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_secret";
  process.env.APP_URL = "https://app.test";
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.APP_URL;
  vi.clearAllMocks();
});

describe("runSendDunningEmails (#265)", () => {
  it("emails every household member and records the stage", async () => {
    vi.mocked(sendDunningEmail).mockResolvedValue(undefined);
    const state = {
      subs: [
        {
          id: "sub_1",
          household_id: "hh_1",
          plan_code: "plus",
          status: "past_due",
          grace_ends_at: "2026-09-30T00:00:00.000Z",
        },
      ],
      deliveries: [] as Delivery[],
    };
    const result = await runSendDunningEmails(
      makeClient(state),
      new ManualClock(new Date("2026-09-23T00:00:00.000Z")),
    );

    expect(result).toEqual({
      checked: 1,
      sent: [{ subscriptionId: "sub_1", householdId: "hh_1", stage: "first_reminder" }],
      skipped: [],
    });
    expect(sendDunningEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["ana@test.local"],
        stage: "first_reminder",
        memberName: "Ana",
        householdName: "Casa Luna",
        manageUrl: "https://app.test/settings",
      }),
    );
    expect(state.deliveries).toHaveLength(1);

    // A retried run sends nothing new.
    const retry = await runSendDunningEmails(
      makeClient(state),
      new ManualClock(new Date("2026-09-23T00:00:00.000Z")),
    );
    expect(retry.sent).toEqual([]);
    expect(vi.mocked(sendDunningEmail)).toHaveBeenCalledTimes(1);
  });

  it("never emails comped households", async () => {
    vi.mocked(sendDunningEmail).mockResolvedValue(undefined);
    const state = {
      subs: [
        {
          id: "sub_c",
          household_id: "hh_c",
          plan_code: "comped",
          status: "grace",
          grace_ends_at: "2026-09-30T00:00:00.000Z",
        },
      ],
      deliveries: [] as Delivery[],
    };
    const result = await runSendDunningEmails(
      makeClient(state),
      new ManualClock(new Date("2026-09-23T00:00:00.000Z")),
    );
    expect(result.sent).toEqual([]);
    expect(sendDunningEmail).not.toHaveBeenCalled();
  });

  it("aborts without RESEND_API_KEY", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(
      runSendDunningEmails(
        makeClient({ subs: [], deliveries: [] }),
        new ManualClock(new Date("2026-09-23T00:00:00.000Z")),
      ),
    ).rejects.toThrow(/RESEND_API_KEY not configured/);
  });
});
