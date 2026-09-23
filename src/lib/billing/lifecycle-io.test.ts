import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import { createMoney } from "./money";
import type { BillingEvent } from "./provider";
import {
  applyBillingEvent,
  expireDueSubscriptions,
  isExpirable,
  type ExpirableRow,
} from "./lifecycle";
import type { Database } from "@/lib/supabase/types";

const NOW = new Date("2026-11-01T00:00:00.000Z");
const clock = () => new ManualClock(NOW);

type FakeSub = {
  id: string;
  household_id: string;
  plan_code: string;
  provider: string;
  provider_ref: string | null;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
  cancel_at_period_end: boolean;
};

// Minimal postgrest-chain emulator: billing_events rows with 23505 on
// conflict plus chainable update, subscriptions select/insert/update with
// eq/in filtering. Mirrors the makeClient fake style in
// app/api/cron/fx-refresh/route.test.ts.
type FakeEvent = {
  provider: string;
  provider_event_id: string;
  subscription_id: string | null;
};

function makeDb(state: {
  subs: FakeSub[];
  events: FakeEvent[];
  updates?: unknown[];
  /** Force the next subscriptions insert to fail with this error. */
  failNextSubInsert?: { code: string; message: string };
}) {
  const match = (row: FakeSub, filters: { col: string; op: string; value: unknown }[]) =>
    filters.every((f) =>
      f.op === "eq"
        ? (row as unknown as Record<string, unknown>)[f.col] === f.value
        : (f.value as unknown[]).includes((row as unknown as Record<string, unknown>)[f.col]),
    );
  const from = (table: string) => {
    if (table === "billing_events") {
      return {
        insert: async (input: { provider: string; provider_event_id: string }) => {
          const key = `${input.provider}|${input.provider_event_id}`;
          if (state.events.some((e) => `${e.provider}|${e.provider_event_id}` === key)) {
            return { error: { code: "23505", message: "duplicate key" } };
          }
          state.events.push({ ...input, subscription_id: null });
          return { error: null };
        },
        update: (values: Record<string, unknown>) => {
          const filters: { col: string; value: unknown }[] = [];
          const chain: Record<string, unknown> = {};
          chain.eq = (col: string, value: unknown) => {
            filters.push({ col, value });
            return chain;
          };
          chain.then = (resolve: (v: unknown) => void) => {
            for (const e of state.events) {
              if (
                filters.every((f) => (e as unknown as Record<string, unknown>)[f.col] === f.value)
              ) {
                Object.assign(e, values);
              }
            }
            resolve({ error: null });
          };
          return chain;
        },
      };
    }
    if (table === "plans") {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, value: string) => ({
            maybeSingle: async () => ({
              data: ["free", "plus"].includes(value) ? { code: value } : null,
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "subscriptions") {
      return {
        select: (_cols: string) => {
          const filters: { col: string; op: string; value: unknown }[] = [];
          const chain: Record<string, unknown> = {};
          chain.eq = (col: string, value: unknown) => {
            filters.push({ col, op: "eq", value });
            return chain;
          };
          chain.in = (col: string, values: unknown) => {
            filters.push({ col, op: "in", value: values });
            return chain;
          };
          chain.maybeSingle = async () => ({
            data: state.subs.find((r) => match(r, filters)) ?? null,
            error: null,
          });
          chain.then = (resolve: (v: unknown) => void) =>
            resolve({ data: state.subs.filter((r) => match(r, filters)), error: null });
          return chain;
        },
        insert: (input: Record<string, unknown>) => ({
          select: (_cols: string) => ({
            single: async () => {
              if (state.failNextSubInsert) {
                const error = state.failNextSubInsert;
                state.failNextSubInsert = undefined;
                return { data: null, error };
              }
              const created = { id: `sub_${state.subs.length + 1}`, ...input } as FakeSub;
              state.subs.push(created);
              return { data: { id: created.id }, error: null };
            },
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: async (col: string, value: unknown) => {
            for (const r of state.subs) {
              if ((r as unknown as Record<string, unknown>)[col] === value) {
                Object.assign(r, values);
                state.updates?.push({ id: r.id, values });
              }
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

function sub(overrides: Partial<FakeSub> = {}): FakeSub {
  return {
    id: "sub_1",
    household_id: "hh_1",
    plan_code: "plus",
    provider: "stub",
    provider_ref: "stub_sub_1",
    status: "trialing",
    trial_ends_at: "2026-10-23T00:00:00.000Z",
    current_period_end: "2026-11-23T00:00:00.000Z",
    grace_ends_at: null,
    cancel_at_period_end: false,
    ...overrides,
  };
}

const activated: BillingEvent = {
  type: "subscription.activated",
  ref: "stub_sub_1",
  planCode: "plus",
  periodEnd: new Date("2026-11-23T00:00:00.000Z"),
};

describe("applyBillingEvent (#260)", () => {
  it("creates on first activation, then moves trialing → active on payment", async () => {
    const db = makeDb({ subs: [], events: [] });
    const created = await applyBillingEvent(
      db,
      { provider: "stub", providerEventId: "evt_1", event: activated, householdId: "hh_1" },
      clock(),
    );
    expect(created).toEqual({ outcome: "applied", status: "trialing" });

    const paid = await applyBillingEvent(
      db,
      {
        provider: "stub",
        providerEventId: "evt_2",
        event: {
          type: "payment.succeeded",
          ref: "stub_sub_1",
          amount: createMoney(12900, "NIO"),
          periodEnd: new Date("2026-12-23T00:00:00.000Z"),
        },
      },
      clock(),
    );
    expect(paid).toEqual({ outcome: "applied", status: "active" });
  });

  it("applying the same event twice changes state once", async () => {
    const updates: unknown[] = [];
    const db = makeDb({ subs: [sub({ status: "active" })], events: [], updates });
    const input = {
      provider: "stub",
      providerEventId: "evt_9",
      event: {
        type: "payment.failed",
        ref: "stub_sub_1",
        attempt: 1,
      } as BillingEvent,
    };
    expect(await applyBillingEvent(db, input, clock())).toEqual({
      outcome: "applied",
      status: "past_due",
    });
    expect(await applyBillingEvent(db, input, clock())).toEqual({ outcome: "duplicate" });
    expect(updates).toHaveLength(1);
    expect((updates[0] as { values: Record<string, unknown> }).values.grace_ends_at).toBe(
      "2026-11-08T00:00:00.000Z",
    );
  });

  it("records unknown event types without throwing the worker", async () => {
    const events: FakeEvent[] = [];
    const db = makeDb({ subs: [sub({ status: "active" })], events });
    const alien = { type: "refund.issued", ref: "stub_sub_1" } as unknown as BillingEvent;
    const result = await applyBillingEvent(
      db,
      { provider: "stub", providerEventId: "evt_x", event: alien },
      clock(),
    );
    expect(result.outcome).toBe("rejected");
    expect(events.some((e) => e.provider_event_id === "evt_x")).toBe(true);
  });

  it("rejects invalid transitions (and unknown plans) without throwing", async () => {
    const db = makeDb({ subs: [], events: [] });
    const failed = { type: "payment.failed", ref: "stub_sub_1", attempt: 1 } as BillingEvent;
    expect(
      await applyBillingEvent(
        db,
        { provider: "stub", providerEventId: "evt_1", event: failed, householdId: "hh_1" },
        clock(),
      ),
    ).toMatchObject({ outcome: "rejected" });

    const bogusPlan: BillingEvent = {
      type: "subscription.activated",
      ref: "stub_sub_1",
      planCode: "platinum",
      periodEnd: new Date("2026-11-23T00:00:00.000Z"),
    };
    expect(
      await applyBillingEvent(
        db,
        { provider: "stub", providerEventId: "evt_2", event: bogusPlan, householdId: "hh_1" },
        clock(),
      ),
    ).toMatchObject({ outcome: "rejected", reason: expect.stringMatching(/unknown plan/) });
  });

  it("rejects malformed dates as recorded rejections (retry is then duplicate)", async () => {
    const db = makeDb({ subs: [sub({ status: "active" })], events: [] });
    const broken = {
      type: "payment.succeeded",
      ref: "stub_sub_1",
      amount: { amount: 12900, currency: "NIO" },
      periodEnd: null,
    } as unknown as BillingEvent;
    const input = { provider: "stub", providerEventId: "evt_bad", event: broken };
    const first = await applyBillingEvent(db, input, clock());
    expect(first.outcome).toBe("rejected");
    expect(first).toMatchObject({ reason: expect.stringMatching(/periodEnd/) });
    // The rejection was recorded, so the retry is an honest duplicate —
    // never a silent success and never a second throw.
    expect(await applyBillingEvent(db, input, clock())).toEqual({ outcome: "duplicate" });
  });

  it("links event rows to subscription rows (backfilled on create)", async () => {
    const events: FakeEvent[] = [];
    const db = makeDb({ subs: [], events });
    await applyBillingEvent(
      db,
      { provider: "stub", providerEventId: "evt_1", event: activated, householdId: "hh_1" },
      clock(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.subscription_id).toBe("sub_1");
  });

  it("turns creation races into duplicate/rejected instead of 500 loops", async () => {
    const liveConflict = makeDb({
      subs: [],
      events: [],
      failNextSubInsert: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "subscriptions_one_live"',
      },
    });
    expect(
      await applyBillingEvent(
        liveConflict,
        { provider: "stub", providerEventId: "evt_1", event: activated, householdId: "hh_1" },
        clock(),
      ),
    ).toMatchObject({ outcome: "rejected", reason: expect.stringMatching(/live subscription/) });

    const refConflict = makeDb({
      subs: [],
      events: [],
      failNextSubInsert: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "subscriptions_provider_provider_ref_key"',
      },
    });
    expect(
      await applyBillingEvent(
        refConflict,
        { provider: "stub", providerEventId: "evt_2", event: activated, householdId: "hh_1" },
        clock(),
      ),
    ).toEqual({ outcome: "duplicate" });
  });
});

describe("isExpirable (#260)", () => {
  const base: ExpirableRow = {
    id: "s",
    status: "active",
    trial_ends_at: null,
    current_period_end: "2026-12-01T00:00:00.000Z",
    grace_ends_at: null,
  };
  it.each([
    [
      "past_due past its window",
      { ...base, status: "past_due", grace_ends_at: "2026-10-30T00:00:00.000Z" },
      true,
    ],
    [
      "past_due inside its window",
      { ...base, status: "past_due", grace_ends_at: "2026-11-08T00:00:00.000Z" },
      false,
    ],
    [
      "grace exactly at its end",
      { ...base, status: "grace", grace_ends_at: "2026-11-01T00:00:00.000Z" },
      true,
    ],
    ["grace without a window", { ...base, status: "grace", grace_ends_at: null }, false],
    [
      "cancelled past period end",
      { ...base, status: "cancelled", current_period_end: "2026-10-23T00:00:00.000Z" },
      true,
    ],
    [
      "cancelled inside period end",
      { ...base, status: "cancelled", current_period_end: "2026-11-23T00:00:00.000Z" },
      false,
    ],
    [
      "cancelled with no period end",
      { ...base, status: "cancelled", current_period_end: null },
      true,
    ],
    [
      "trialing past trial end",
      { ...base, status: "trialing", trial_ends_at: "2026-10-23T00:00:00.000Z" },
      true,
    ],
    [
      "trialing inside trial",
      { ...base, status: "trialing", trial_ends_at: "2026-11-23T00:00:00.000Z" },
      false,
    ],
    [
      "active with lapsed period (dunning owns it, not the sweeper)",
      { ...base, status: "active", current_period_end: "2026-10-01T00:00:00.000Z" },
      false,
    ],
    ["expired rows are done", { ...base, status: "expired" }, false],
  ])("%s → %s", (_label, row, expected) => {
    expect(isExpirable(row, NOW)).toBe(expected);
  });
});

describe("expireDueSubscriptions (#260)", () => {
  it("expires only time-ended rows and is safe to run twice in the same minute", async () => {
    const updates: unknown[] = [];
    const db = makeDb({
      subs: [
        sub({ id: "s_past", status: "past_due", grace_ends_at: "2026-10-30T00:00:00.000Z" }),
        sub({ id: "s_grace", status: "grace", grace_ends_at: "2026-11-08T00:00:00.000Z" }),
        sub({
          id: "s_cancel",
          status: "cancelled",
          current_period_end: "2026-10-23T00:00:00.000Z",
        }),
        sub({
          id: "s_cancel_live",
          status: "cancelled",
          current_period_end: "2026-11-23T00:00:00.000Z",
        }),
        sub({ id: "s_trial", status: "trialing", trial_ends_at: "2026-10-23T00:00:00.000Z" }),
      ],
      events: [],
      updates,
    });
    const first = await expireDueSubscriptions(db, clock());
    expect(first.checked).toBe(5);
    expect(first.expired.sort()).toEqual(["s_cancel", "s_past", "s_trial"]);
    expect(updates).toHaveLength(3);

    const second = await expireDueSubscriptions(db, clock());
    expect(second.expired).toEqual([]);
    expect(updates).toHaveLength(3);
  });
});
