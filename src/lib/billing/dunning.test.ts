import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import {
  clearDunningForSubscription,
  planDunningStages,
  runDunningJob,
  type DunningCandidate,
  type DunningJobDeps,
  type DunningJobResult,
  type DunningStage,
} from "./dunning";
import { COMPED_PLAN_CODE, DUNNING_SCHEDULE, DUNNING_STAGES } from "./dunning-schedule";
import type { Database } from "@/lib/supabase/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date("2026-09-23T00:00:00.000Z");

// Fake persistence layer: subscriptions filtered by status, dunning_deliveries
// rows with claim-first semantics (insert 23505 on (subscription_id, stage)
// conflict, chained-eq select/update/delete). Mirrors the chainable style in
// lifecycle-io.test.ts.
type Delivery = {
  subscription_id: string;
  household_id: string;
  stage: string;
  claimed_at: string;
  sent_at: string | null;
};

function makeDb(
  state: {
    subs: DunningCandidate[];
    deliveries: Delivery[];
  },
  opts: {
    /** Next adopt-CAS update matches 0 rows (a concurrent adopter won). */
    failNextAdopt?: boolean;
    /** Complete updates fail (crash between send and sent_at write). */
    failComplete?: boolean;
  } = {},
) {
  const matchDelivery = (row: Delivery, filters: Array<{ col: string; value: unknown }>) =>
    filters.every((f) => (row as unknown as Record<string, unknown>)[f.col] === f.value);
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
        select: (_cols: string) => {
          const filters: Array<{ col: string; value: unknown }> = [];
          const chain: Record<string, unknown> = {};
          chain.in = (col: string, values: unknown) => {
            const rows = state.deliveries.filter((d) =>
              (values as string[]).includes(
                (d as unknown as Record<string, unknown>)[col] as string,
              ),
            );
            return Promise.resolve({ data: rows, error: null });
          };
          chain.eq = (col: string, value: unknown) => {
            filters.push({ col, value });
            return chain;
          };
          chain.maybeSingle = async () => ({
            data: state.deliveries.find((d) => matchDelivery(d, filters)) ?? null,
            error: null,
          });
          return chain;
        },
        insert: async (input: {
          subscription_id: string;
          household_id: string;
          stage: string;
          claimed_at: string;
          sent_at: string | null;
        }) => {
          const k = (d: Delivery) => `${d.subscription_id}|${d.stage}`;
          if (state.deliveries.some((d) => k(d) === `${input.subscription_id}|${input.stage}`)) {
            return { error: { code: "23505", message: "duplicate key" } };
          }
          state.deliveries.push({ ...input });
          return { error: null };
        },
        update: (values: Record<string, unknown>) => {
          const filters: Array<{ col: string; value: unknown }> = [];
          const chain: Record<string, unknown> = {};
          chain.eq = (col: string, value: unknown) => {
            filters.push({ col, value });
            return chain;
          };
          chain.select = (_cols: string) => {
            if (opts.failNextAdopt) {
              opts.failNextAdopt = false;
              return Promise.resolve({ data: [], error: null });
            }
            const matched = state.deliveries.filter((d) => matchDelivery(d, filters));
            for (const m of matched) Object.assign(m, values);
            return Promise.resolve({ data: matched, error: null });
          };
          chain.then = (resolve: (v: unknown) => void) => {
            if (opts.failComplete) {
              resolve({ error: { code: "XX000", message: "simulated complete failure" } });
              return;
            }
            const matched = state.deliveries.filter((d) => matchDelivery(d, filters));
            for (const m of matched) Object.assign(m, values);
            resolve({ data: matched, error: null });
          };
          return chain;
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

type SentMail = { to: string[]; stage: DunningStage; memberName: string };

function deps(
  overrides: Partial<DunningJobDeps> = {},
  sent: SentMail[] = [],
): DunningJobDeps & { sent: SentMail[] } {
  return {
    sent,
    resolveHousehold: async (householdId: string) => ({
      householdName: `Hogar ${householdId}`,
      manageUrl: "https://app.test/settings",
      recipients: [{ to: "ana@test.local", memberName: "Ana" }],
    }),
    sendStageEmail: async (input) => {
      sent.push({ to: input.to, stage: input.stage, memberName: input.memberName });
    },
    ...overrides,
  };
}

describe("dunning schedule (#265)", () => {
  it("lives in one place: stages, grace window, final-notice lead, claim lease", () => {
    expect(DUNNING_SCHEDULE.graceDays).toBe(7);
    expect(DUNNING_SCHEDULE.finalNoticeLeadDays).toBe(2);
    expect(DUNNING_SCHEDULE.claimLeaseMinutes).toBe(15);
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
    expect(state.deliveries[0]?.sent_at).toBe("2026-09-23T00:00:00.000Z");

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

  it("a concurrent runner mid-send finds the in-flight claim and sends nothing", async () => {
    // Regression test for the PR #287 review: with send-then-insert, two
    // runners both observed no row and both sent. With claim-first, the
    // runner that claims owns the delivery — a second runner arriving
    // mid-send sees the fresh (unsent) claim and yields.
    const clock = new ManualClock(START);
    const state = { subs: [sub()], deliveries: [] as Delivery[] };
    const db = makeDb(state);
    const sent: SentMail[] = [];
    const inner: { result: DunningJobResult | null } = { result: null };
    const d = deps(
      {
        sendStageEmail: async (input) => {
          if (!inner.result) {
            // Runner 2 fires while runner 1's email is in flight.
            inner.result = await runDunningJob(db, clock, deps());
          }
          sent.push({ to: input.to, stage: input.stage, memberName: input.memberName });
        },
      },
      sent,
    );

    const first = await runDunningJob(db, clock, d);
    expect(first.sent).toHaveLength(1);
    expect(inner.result?.sent).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(state.deliveries).toHaveLength(1);
    expect(state.deliveries[0]?.sent_at).not.toBeNull();
  });

  it("a stale claim is adopted and sent exactly once after the lease", async () => {
    // A crash between claim and send leaves sent_at NULL; past the lease
    // the next run adopts the stage instead of suppressing it forever.
    const clock = new ManualClock(START);
    const state = {
      subs: [sub()],
      deliveries: [
        {
          subscription_id: "sub_1",
          household_id: "hh_1",
          stage: "first_reminder",
          claimed_at: "2026-09-23T00:00:00.000Z",
          sent_at: null,
        },
      ] as Delivery[],
    };
    const db = makeDb(state);
    const d = deps();

    // Inside the 15-minute lease: the claim looks live, nothing sends.
    clock.advance(5 * 60 * 1000);
    const early = await runDunningJob(db, clock, d);
    expect(early.sent).toEqual([]);
    expect(d.sent).toEqual([]);

    // Past the lease: adopted, sent once, completed.
    clock.advance(15 * 60 * 1000);
    const adopted = await runDunningJob(db, clock, d);
    expect(adopted.sent).toEqual([
      { subscriptionId: "sub_1", householdId: "hh_1", stage: "first_reminder" },
    ]);
    expect(d.sent).toHaveLength(1);
    expect(state.deliveries[0]?.sent_at).not.toBeNull();

    // And a third run sends nothing more.
    expect((await runDunningJob(db, clock, d)).sent).toEqual([]);
    expect(d.sent).toHaveLength(1);
  });

  it("a lost adoption race yields without sending", async () => {
    // Two runners adopt the same stale claim simultaneously: the
    // compare-and-swap on claimed_at elects one owner. The loser (0 rows
    // matched) must NOT send.
    const clock = new ManualClock(new Date("2026-09-24T00:00:00.000Z"));
    const state = {
      subs: [sub()],
      deliveries: [
        {
          subscription_id: "sub_1",
          household_id: "hh_1",
          stage: "first_reminder",
          claimed_at: "2026-09-23T00:00:00.000Z",
          sent_at: null,
        },
      ] as Delivery[],
    };
    const db = makeDb(state, { failNextAdopt: true });
    const d = deps();

    const result = await runDunningJob(db, clock, d);
    expect(result.sent).toEqual([]);
    expect(d.sent).toEqual([]);
    expect(state.deliveries[0]?.sent_at).toBeNull();
  });

  it("a crash between send and completion retries the stage on adoption", async () => {
    // Honest tradeoff, stated in dunning.ts: only a crash AFTER delivery
    // but BEFORE the sent_at write can double-send, on lease adoption.
    const clock = new ManualClock(START);
    const state = { subs: [sub()], deliveries: [] as Delivery[] };
    const failDb = makeDb(state, { failComplete: true });
    const d = deps();

    await expect(runDunningJob(failDb, clock, d)).rejects.toThrow(/simulated complete failure/);
    expect(d.sent).toHaveLength(1);
    expect(state.deliveries[0]?.sent_at).toBeNull();

    clock.advance(16 * 60 * 1000);
    const retry = await runDunningJob(makeDb(state), clock, d);
    expect(retry.sent).toHaveLength(1);
    expect(d.sent).toHaveLength(2);
    expect(state.deliveries[0]?.sent_at).not.toBeNull();
  });

  it("a successful payment mid-sequence cancels the rest via lifecycle cleanup", async () => {
    const clock = new ManualClock(START);
    const state = { subs: [sub()], deliveries: [] as Delivery[] };
    const db = makeDb(state);
    const d = deps();

    await runDunningJob(db, clock, d);
    expect(d.sent.map((s) => s.stage)).toEqual(["first_reminder"]);

    // payment.succeeded → active (lifecycle) invokes the reactivation
    // cleanup: the cycle's rows are deleted, cancelling the rest.
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

  it("skips without claiming when nobody can be notified, retries later", async () => {
    const clock = new ManualClock(START);
    const state = { subs: [sub()], deliveries: [] as Delivery[] };
    const db = makeDb(state);
    const d = deps({ resolveHousehold: async () => null });

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

  it("sends one personalized email per member and records one stage row", async () => {
    const clock = new ManualClock(START);
    const state = { subs: [sub()], deliveries: [] as Delivery[] };
    const db = makeDb(state);
    const d = deps({
      resolveHousehold: async () => ({
        householdName: "Casa Luna",
        manageUrl: "https://app.test/settings",
        recipients: [
          { to: "ana@test.local", memberName: "Ana" },
          { to: "bruno@test.local", memberName: "Bruno" },
        ],
      }),
    });

    const result = await runDunningJob(db, clock, d);
    expect(result.sent).toHaveLength(1);
    expect(d.sent).toEqual([
      { to: ["ana@test.local"], stage: "first_reminder", memberName: "Ana" },
      { to: ["bruno@test.local"], stage: "first_reminder", memberName: "Bruno" },
    ]);
    expect(state.deliveries).toHaveLength(1);
  });
});
