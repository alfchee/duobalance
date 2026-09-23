import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import { createMoney } from "./money";
import type { BillingEvent } from "./provider";
import {
  KNOWN_EVENT_TYPES,
  planEventApplication,
  resolveTransition,
  TRANSITIONS,
  type LifecycleFrom,
  type LifecycleStatus,
  type SubscriptionRow,
} from "./lifecycle";

const NOW = new Date("2026-10-23T00:00:00.000Z");
const PERIOD_END = new Date("2026-11-23T00:00:00.000Z");

function clock() {
  return new ManualClock(NOW);
}

function row(status: LifecycleStatus): SubscriptionRow {
  return {
    id: "sub_1",
    household_id: "hh_1",
    plan_code: "plus",
    provider: "stub",
    provider_ref: "stub_sub_1",
    status,
    trial_ends_at: "2026-10-23T00:00:00.000Z",
    current_period_end: "2026-11-23T00:00:00.000Z",
    grace_ends_at: null,
    cancel_at_period_end: false,
  };
}

const activated: BillingEvent = {
  type: "subscription.activated",
  ref: "stub_sub_1",
  planCode: "plus",
  periodEnd: PERIOD_END,
};
const succeeded: BillingEvent = {
  type: "payment.succeeded",
  ref: "stub_sub_1",
  amount: createMoney(12900, "NIO"),
  periodEnd: PERIOD_END,
};
const failed: BillingEvent = { type: "payment.failed", ref: "stub_sub_1", attempt: 1 };
const cancelled: BillingEvent = {
  type: "subscription.cancelled",
  ref: "stub_sub_1",
  effectiveAt: PERIOD_END,
};
const expired: BillingEvent = { type: "subscription.expired", ref: "stub_sub_1" };

// The issue's diagram, encoded as expectations: every (from × event) cell.
// "same"/"ignore"/"reject" outcomes included — the table test below pins the
// code to this contract, so diagram drift fails loudly.
const DIAGRAM: Record<LifecycleFrom, Record<string, string>> = {
  none: {
    "subscription.activated": "trialing",
    "payment.succeeded": "reject",
    "payment.failed": "reject",
    "subscription.cancelled": "reject",
    "subscription.expired": "reject",
  },
  trialing: {
    "subscription.activated": "active",
    "payment.succeeded": "active",
    "payment.failed": "past_due",
    "subscription.cancelled": "cancelled",
    "subscription.expired": "expired",
  },
  active: {
    "subscription.activated": "active",
    "payment.succeeded": "active",
    "payment.failed": "past_due",
    "subscription.cancelled": "cancelled",
    "subscription.expired": "expired",
  },
  past_due: {
    "subscription.activated": "active",
    "payment.succeeded": "active",
    "payment.failed": "grace",
    "subscription.cancelled": "cancelled",
    "subscription.expired": "expired",
  },
  grace: {
    "subscription.activated": "active",
    "payment.succeeded": "active",
    "payment.failed": "expired",
    "subscription.cancelled": "cancelled",
    "subscription.expired": "expired",
  },
  cancelled: {
    "subscription.activated": "active",
    "payment.succeeded": "ignore",
    "payment.failed": "ignore",
    "subscription.cancelled": "same",
    "subscription.expired": "expired",
  },
  expired: {
    "subscription.activated": "active",
    "payment.succeeded": "ignore",
    "payment.failed": "ignore",
    "subscription.cancelled": "same",
    "subscription.expired": "same",
  },
};

describe("lifecycle transition table (#260)", () => {
  it("defines every diagram cell (no missing transitions)", () => {
    const froms = Object.keys(DIAGRAM) as LifecycleFrom[];
    for (const from of froms) {
      for (const type of KNOWN_EVENT_TYPES) {
        expect(TRANSITIONS[from][type], `${from} × ${type} must be defined`).toBeDefined();
      }
    }
  });

  it("matches the diagram for every cell", () => {
    for (const [from, cells] of Object.entries(DIAGRAM)) {
      for (const [type, expected] of Object.entries(cells)) {
        expect(resolveTransition(from as LifecycleFrom, type).to, `${from} × ${type}`).toBe(
          expected,
        );
      }
    }
  });

  it("rejects unknown event types without throwing", () => {
    const def = resolveTransition("active", "refund.issued");
    expect(def.to).toBe("reject");
    expect(def.reason).toMatch(/unknown event type/);
  });

  it("rejects unknown statuses instead of throwing on the lookup", () => {
    const def = resolveTransition("mystery" as LifecycleFrom, "payment.succeeded");
    expect(def.to).toBe("reject");
    expect(def.reason).toMatch(/unknown subscription status/);
  });

  it("every activation entry carries the plan-code upsert", () => {
    for (const from of Object.keys(DIAGRAM) as LifecycleFrom[]) {
      if (from === "none") continue;
      expect(
        TRANSITIONS[from]["subscription.activated"]?.takePlanCode,
        `${from} × activated must upsert plan_code`,
      ).toBe(true);
    }
  });

  it("rejects at least three invalid transitions", () => {
    expect(resolveTransition("none", "payment.failed").to).toBe("reject");
    expect(resolveTransition("none", "subscription.cancelled").to).toBe("reject");
    expect(resolveTransition("none", "subscription.expired").to).toBe("reject");
    expect(resolveTransition("none", "payment.succeeded").to).toBe("reject");
  });
});

describe("planEventApplication (#260)", () => {
  it("creates a trialing row on first activation (needs householdId)", () => {
    const plan = planEventApplication(null, activated, "hh_1", clock());
    expect(plan.outcome).toBe("create");
    if (plan.outcome !== "create") throw new Error("unreachable");
    expect(plan.status).toBe("trialing");
    expect(plan.insert).toMatchObject({
      household_id: "hh_1",
      plan_code: "plus",
      status: "trialing",
      provider_ref: "stub_sub_1",
      trial_ends_at: PERIOD_END.toISOString(),
      current_period_end: PERIOD_END.toISOString(),
      cancel_at_period_end: false,
    });
  });

  it("rejects creation without a household and without a plan carrier", () => {
    const noHousehold = planEventApplication(null, activated, null, clock());
    expect(noHousehold.outcome).toBe("rejected");
    const noPlan = planEventApplication(null, succeeded, "hh_1", clock());
    expect(noPlan.outcome).toBe("rejected");
  });

  it("populates grace_ends_at whenever entering past_due or grace", () => {
    const pastDue = planEventApplication(row("active"), failed, null, clock());
    expect(pastDue.outcome).toBe("applied");
    if (pastDue.outcome !== "applied") throw new Error("unreachable");
    expect(pastDue.status).toBe("past_due");
    // now + 7 days off the injected clock — never wall-clock.
    expect(pastDue.update.grace_ends_at).toBe("2026-10-30T00:00:00.000Z");

    const grace = planEventApplication(
      { ...row("active"), status: "past_due" },
      failed,
      null,
      clock(),
    );
    if (grace.outcome !== "applied") throw new Error("unreachable");
    expect(grace.status).toBe("grace");
    expect(grace.update.grace_ends_at).toBe("2026-10-30T00:00:00.000Z");
  });

  it("keeps cancelled entitled until period end (cancel_at_period_end + effectiveAt)", () => {
    const plan = planEventApplication(row("active"), cancelled, null, clock());
    expect(plan.outcome).toBe("applied");
    if (plan.outcome !== "applied") throw new Error("unreachable");
    expect(plan.status).toBe("cancelled");
    expect(plan.update).toMatchObject({
      status: "cancelled",
      current_period_end: PERIOD_END.toISOString(),
      cancel_at_period_end: true,
    });
  });

  it("clears the stale grace window on cancel (household_plan prefers grace)", () => {
    const pastDue = {
      ...row("active"),
      status: "past_due" as LifecycleStatus,
      grace_ends_at: "2026-12-31T00:00:00.000Z",
    };
    const plan = planEventApplication(pastDue, cancelled, null, clock());
    expect(plan.outcome).toBe("applied");
    if (plan.outcome !== "applied") throw new Error("unreachable");
    expect(plan.update.grace_ends_at).toBeNull();
    expect(plan.update.current_period_end).toBe(PERIOD_END.toISOString());
  });

  it("recovers cleanly on payment (clears grace + cancel flag, refreshes period)", () => {
    const pastDue = {
      ...row("active"),
      status: "past_due" as LifecycleStatus,
      grace_ends_at: "2026-10-30T00:00:00.000Z",
      cancel_at_period_end: false,
    };
    const plan = planEventApplication(pastDue, succeeded, null, clock());
    if (plan.outcome !== "applied") throw new Error("unreachable");
    expect(plan.update).toMatchObject({
      status: "active",
      current_period_end: PERIOD_END.toISOString(),
      grace_ends_at: null,
      cancel_at_period_end: false,
    });
  });

  it("expires cleanly on provider expiry (no live period left)", () => {
    const plan = planEventApplication(row("grace"), expired, null, clock());
    expect(plan.outcome).toBe("applied");
    if (plan.outcome !== "applied") throw new Error("unreachable");
    expect(plan.status).toBe("expired");
    expect(plan.update.current_period_end).toBeNull();
  });

  it("moves plan_code on reactivation; payment alone never does", () => {
    const cancelledRow = { ...row("active"), status: "cancelled" as LifecycleStatus };
    const downgrade: BillingEvent = {
      type: "subscription.activated",
      ref: "stub_sub_1",
      planCode: "free",
      periodEnd: PERIOD_END,
    };
    const revived = planEventApplication(cancelledRow, downgrade, null, clock());
    expect(revived.outcome).toBe("applied");
    if (revived.outcome !== "applied") throw new Error("unreachable");
    expect(revived.update.plan_code).toBe("free");

    const paid = planEventApplication(row("active"), succeeded, null, clock());
    if (paid.outcome !== "applied") throw new Error("unreachable");
    expect(paid.update.plan_code).toBeUndefined();
  });

  it("ignores stale money on terminal statuses and reactivates on activated", () => {
    const cancelledRow = { ...row("active"), status: "cancelled" as LifecycleStatus };
    const stale = planEventApplication(cancelledRow, succeeded, null, clock());
    expect(stale.outcome).toBe("ignored");

    const expiredRow = { ...row("active"), status: "expired" as LifecycleStatus };
    expect(planEventApplication(expiredRow, succeeded, null, clock()).outcome).toBe("ignored");
    expect(planEventApplication(expiredRow, failed, null, clock()).outcome).toBe("ignored");

    const revived = planEventApplication(expiredRow, activated, null, clock());
    expect(revived.outcome).toBe("applied");
    if (revived.outcome !== "applied") throw new Error("unreachable");
    expect(revived.status).toBe("active");
  });

  it("rejects invalid Money on payment.succeeded", () => {
    const bad = {
      type: "payment.succeeded",
      ref: "stub_sub_1",
      amount: { amount: 1, currency: "ABC" },
      periodEnd: PERIOD_END,
    } as unknown as BillingEvent;
    expect(planEventApplication(row("active"), bad, null, clock()).outcome).toBe("rejected");
  });
});
