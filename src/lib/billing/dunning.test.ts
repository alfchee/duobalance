import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ManualClock } from "./clock";
import {
  clearDunningForSubscription,
  COMPED_PLAN_CODE,
  DUNNING_SCHEDULE,
  DUNNING_STAGES,
  planDunningStages,
  runDunningJob,
  type DunningCandidate,
  type DunningJobDeps,
  type DunningStage,
} from "./dunning";
import type { Database } from "@/lib/supabase/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date("2026-09-23T00:00:00.000Z");

// Fake persistence layer: subscriptions filtered by status, dunning_deliveries
// rows with 23505 on (subscription_id, stage) conflict plus eq-delete.
// Mirrors the chainable style in lifecycle-io.test.ts.
type Delivery = { subscription_id: string; household_id: string; stage: string; sent_at: string };

function makeDb(state: {
  subs: DunningCandidate[];
  deliveries: Delivery[];
  /** Force every delivery insert to 23505 (concurrent-runner race). */
  alwaysConflict?: boolean;
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
    if (table === "dunning_deliveries") {
      return {
        select: (_cols: string) => ({
          in: async (_col: string, values: unknown[]) => ({
            data: state.deliveries.filter((d) => (values as string[]).includes(d.subscription_id)),
            error: null,
          }),
        }),
        insert: async (input: {
          subscription_id: string;
          household_id: string;
          stage: string;
          sent_at: string;
        }) => {
          const key = `${input.subscription_id}|${input.stage}`;
          if (
            state.alwaysConflict ||
            state.deliveries.some((d) => `${d.subscription_id}|${d.stage}` === key)
          ) {
            return { error: { code: "23505", message: "duplicate key" } };
          }
          state.deliveries.push({ ...input });
          return { error: null };
        },
        delete: () => ({
          eq: async (col: string, value: unknown) => {
            if (col === "subscription_id") {
              state.deliveries = state.deliveries.filter((d) => d.subscription_id !== value);
            }
            return { error: null };
          },
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  };
  return { from } as unknown as SupabaseClient<Database>;
}

function sub(overrides: Partial<DunningCandidate> = {}): DunningCandidate {
  return {
    id: "sub_1",
    household_id: "hh_1",
    plan_code: "plus",
    status: "past_due",
    grace_ends_at: "2026-09-30T00:00:00.000Z",
    ...overrides,
  };
}

function deps(overrides: Partial<DunningJobDeps> = {}): DunningJobDeps & {
  sent: Array<{ to: string[]; stage: DunningStage }>;
} {
  const sent: Array<{ to: string[]; stage: DunningStage }> = [];
  return {
    sent,
    resolveRecipients: async (householdId: string) => ({
      to: ["ana@test.local"],
      memberName: "Ana",
      householdName: `Hogar ${householdId}`,
      manageUrl: "https://app.test/settings",
    }),
    sendStageEmail: async (input) => {
      sent.push({ to: input.to, stage: input.stage });
    },
    ...overrides,
  };
}

describe("dunning schedule (#265)", () => {
  it("lives in one place: stages, grace window and final-notice lead", () => {
    expect(DUNNING_SCHEDULE.graceDays).toBe(7);
    expect(DUNNING_SCHEDULE.finalNoticeLeadDays).toBe(2);
    expect(DUNNING_SCHEDULE.stages.map((s) => s.stage)).toEqual([...DUNNING_STAGES]);
  });

  it("past_due owes the first reminder; anything else owes nothing", () => {
    expect(planDunningStages(sub({ status: "past_due" }), new Date(START))).toEqual([
      "first_reminder",
    ]);
    for (const status of ["trialing", "active", "cancelled", "expired"]) {
      expect(planDunningStages(sub({ status }), new Date(START))).toEqual([]);
    }
  });

  it("grace owes first + second, and the final notice once the window is nearly over", () => {
    const grace = sub({ status: "grace", grace_ends_at: "2026-09-30T00:00:00.000Z" });
    // 7 days out: reminders only, no final notice yet.
    expect(planDunningStages(grace, new Date("2026-09-23T00:00:00.000Z"))).toEqual([
      "first_reminder",
      "second_reminder",
    ]);
    // Inside the 2-day lead (2026-09-28+): final notice joins.
    expect(planDunningStages(grace, new Date("2026-09-29T00:00:00.000Z"))).toEqual([
      "first_reminder",
      "second_reminder",
      "final_notice",
    ]);
  });

  it("comped plans never enter dunning, whatever the status", () => {
    const compedPastDue = sub({ plan_code: COMPED_PLAN_CODE, status: "past_due" });
    const compedGrace = sub({
      plan_code: COMPED_PLAN_CODE,
      status: "grace",
      grace_ends_at: "2026-09-24T00:00:00.000Z",
    });
    expect(planDunningStages(compedPastDue, new Date(START))).toEqual([]);
    expect(planDunningStages(compedGrace, new Date(START))).toEqual([]);
  });
});

describe("runDunningJob (#265)", () => {
  it("walks first failure → expiry with one email per stage on the test clock", async () => {
    const clock = new ManualClock(START);
    const state = { subs: [sub()], deliveries: [] as Delivery[] };
    const db = makeDb(state);
    const d = deps();

    // First failed payment → past_due: first reminder goes out.
    const first = await runDunningJob(db, clock, d);
    expect(first.checked).toBe(1);
    expect(first.sent).toEqual([
      { subscriptionId: "sub_1", householdId: "hh_1", stage: "first_reminder" },
    ]);
    expect(d.sent.map((s) => s.stage)).toEqual(["first_reminder"]);

    // Second failure 3 days in → grace with a refreshed window (mirrors the
    // lifecycle: grace_ends_at = now + 7d): second reminder, no final yet.
    clock.advance(3 * DAY_MS);
    state.subs[0] = sub({ status: "grace", grace_ends_at: "2026-10-03T00:00:00.000Z" });
    const second = await runDunningJob(db, clock, d);
    expect(second.sent).toEqual([
      { subscriptionId: "sub_1", householdId: "hh_1", stage: "second_reminder" },
    ]);

    // 8 simulated days in, inside the 2-day lead: final notice.
    clock.advance(5 * DAY_MS);
    const third = await runDunningJob(db, clock, d);
    expect(third.sent).toEqual([
      { subscriptionId: "sub_1", householdId: "hh_1", stage: "final_notice" },
    ]);

    // Past the deadline the sweeper would expire the row (lifecycle); the
    // job itself sends nothing more for an expired row.
    clock.advance(3 * DAY_MS);
    state.subs[0] = sub({ status: "expired", grace_ends_at: null });
    const fourth = await runDunningJob(db, clock, d);
    expect(fourth.sent).toEqual([]);
    expect(d.sent.map((s) => s.stage)).toEqual([
      "first_reminder",
      "second_reminder",
      "final_notice",
    ]);
    // ~11 simulated days, zero real elapsed time (ManualClock, no sleeps).
    expect(clock.now().getTime() - START.getTime()).toBe(11 * DAY_MS);
  });

  it("sends exactly once per stage when the job runs twice", async () => {
    const clock = new ManualClock(START);
    const state = { subs: [sub()], deliveries: [] as Delivery[] };
    const db = makeDb(state);
    const d = deps();

    const first = await runDunningJob(db, clock, d);
    const retry = await runDunningJob(db, clock, d);
    expect(first.sent).toHaveLength(1);
    expect(retry.sent).toEqual([]);
    expect(retry.checked).toBe(1);
    expect(d.sent).toHaveLength(1);
    expect(state.deliveries).toHaveLength(1);
  });

  it("a concurrent run racing the insert still delivers exactly one email", async () => {
    const clock = new ManualClock(START);
    // Empty ledger on read, 23505 on write: the other run won the race.
    const state = { subs: [sub()], deliveries: [] as Delivery[], alwaysConflict: true };
    const db = makeDb(state);
    const sendStageEmail = vi.fn(async () => {});
    const d = deps({ sendStageEmail });

    const result = await runDunningJob(db, clock, d);
    expect(sendStageEmail).toHaveBeenCalledTimes(1);
    expect(result.sent).toEqual([
      { subscriptionId: "sub_1", householdId: "hh_1", stage: "first_reminder" },
    ]);
  });

  it("a successful payment mid-sequence cancels the rest and restores active", async () => {
    const clock = new ManualClock(START);
    const state = { subs: [sub()], deliveries: [] as Delivery[] };
    const db = makeDb(state);
    const d = deps();

    await runDunningJob(db, clock, d);
    expect(d.sent.map((s) => s.stage)).toEqual(["first_reminder"]);

    // payment.succeeded → active (lifecycle) + reactivation cleanup.
    state.subs[0] = sub({ status: "active", grace_ends_at: null });
    await clearDunningForSubscription(db, "sub_1");

    clock.advance(5 * DAY_MS);
    const after = await runDunningJob(db, clock, d);
    expect(after.sent).toEqual([]);
    expect(d.sent).toHaveLength(1);

    // A LATER failure starts a fresh cycle at stage 1 (stale rows cleared).
    state.subs[0] = sub({ grace_ends_at: "2026-10-12T00:00:00.000Z" });
    const fresh = await runDunningJob(db, clock, d);
    expect(fresh.sent).toEqual([
      { subscriptionId: "sub_1", householdId: "hh_1", stage: "first_reminder" },
    ]);
  });

  it("never touches comped subscriptions, even a year later", async () => {
    const clock = new ManualClock(START);
    const state = {
      subs: [sub({ id: "sub_comped", plan_code: COMPED_PLAN_CODE, status: "grace" })],
      deliveries: [] as Delivery[],
    };
    const db = makeDb(state);
    const d = deps();

    clock.advance(365 * DAY_MS);
    const result = await runDunningJob(db, clock, d);
    expect(result.sent).toEqual([]);
    expect(d.sent).toEqual([]);
    expect(state.deliveries).toEqual([]);
  });

  it("skips without recording when nobody can be notified, retries later", async () => {
    const clock = new ManualClock(START);
    const state = { subs: [sub()], deliveries: [] as Delivery[] };
    const db = makeDb(state);
    const d = deps({ resolveRecipients: async () => null });

    const skipped = await runDunningJob(db, clock, d);
    expect(skipped.sent).toEqual([]);
    expect(skipped.skipped).toHaveLength(1);
    expect(state.deliveries).toEqual([]);

    // Members appear later: the stage goes out (nothing was suppressed).
    const d2 = deps();
    const retried = await runDunningJob(db, clock, d2);
    expect(retried.sent).toHaveLength(1);
    expect(d2.sent.map((s) => s.stage)).toEqual(["first_reminder"]);
  });
});
