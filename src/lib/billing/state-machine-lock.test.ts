import { describe, expect, it } from "vitest";
import { DUNNING_GRACE_DAYS, KNOWN_EVENT_TYPES, resolveTransition, TRANSITIONS } from "./lifecycle";

// State-machine lock (#266): the transition table IS the contract the
// Phase B adapter must satisfy. Any added, removed or re-targeted
// transition fails this test until the suite is updated alongside it.

const ACTIVATED_ENTRY = {
  to: "active",
  periodFrom: "periodEnd",
  clearGrace: true,
  cancelAtPeriodEnd: false,
  takePlanCode: true,
};

const RECOVER_ENTRY = {
  to: "active",
  periodFrom: "periodEnd",
  clearGrace: true,
  cancelAtPeriodEnd: false,
};

const CANCELLED_ENTRY = {
  to: "cancelled",
  periodFrom: "effectiveAt",
  clearGrace: true,
  cancelAtPeriodEnd: true,
};

const noRow = (type: string) => ({
  to: "reject",
  reason: `no subscription row for ${type}: needs a prior subscription.activated`,
});

describe("billing state machine lock (#266)", () => {
  it("covers exactly the six lifecycle states plus the none origin", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([
      "active",
      "cancelled",
      "expired",
      "grace",
      "none",
      "past_due",
      "trialing",
    ]);
  });

  it("handles exactly the five known event types from every state", () => {
    for (const from of Object.keys(TRANSITIONS)) {
      expect(
        Object.keys(TRANSITIONS[from as keyof typeof TRANSITIONS]).sort(),
        `events handled from ${from}`,
      ).toEqual([...KNOWN_EVENT_TYPES].sort());
    }
    expect(KNOWN_EVENT_TYPES).toHaveLength(5);
    expect(DUNNING_GRACE_DAYS).toBe(7);
  });

  it("pins the full transition table", () => {
    expect(TRANSITIONS).toEqual({
      none: {
        "subscription.activated": {
          to: "trialing",
          periodFrom: "periodEnd",
          cancelAtPeriodEnd: false,
          seedTrial: true,
        },
        "payment.succeeded": noRow("payment.succeeded"),
        "payment.failed": noRow("payment.failed"),
        "subscription.cancelled": noRow("subscription.cancelled"),
        "subscription.expired": noRow("subscription.expired"),
      },
      trialing: {
        "subscription.activated": ACTIVATED_ENTRY,
        "payment.succeeded": RECOVER_ENTRY,
        "payment.failed": { to: "past_due", refreshGrace: true },
        "subscription.cancelled": CANCELLED_ENTRY,
        "subscription.expired": { to: "expired", clearPeriod: true },
      },
      active: {
        "subscription.activated": ACTIVATED_ENTRY,
        "payment.succeeded": RECOVER_ENTRY,
        "payment.failed": { to: "past_due", refreshGrace: true },
        "subscription.cancelled": CANCELLED_ENTRY,
        "subscription.expired": { to: "expired", clearPeriod: true },
      },
      past_due: {
        "subscription.activated": ACTIVATED_ENTRY,
        "payment.succeeded": RECOVER_ENTRY,
        "payment.failed": { to: "grace", refreshGrace: true },
        "subscription.cancelled": CANCELLED_ENTRY,
        "subscription.expired": { to: "expired", clearPeriod: true },
      },
      grace: {
        "subscription.activated": ACTIVATED_ENTRY,
        "payment.succeeded": RECOVER_ENTRY,
        "payment.failed": { to: "expired", clearPeriod: true },
        "subscription.cancelled": CANCELLED_ENTRY,
        "subscription.expired": { to: "expired", clearPeriod: true },
      },
      cancelled: {
        "subscription.activated": ACTIVATED_ENTRY,
        "payment.succeeded": {
          to: "ignore",
          reason: "stale payment for a cancelled subscription",
        },
        "payment.failed": {
          to: "ignore",
          reason: "stale retry for a cancelled subscription",
        },
        "subscription.cancelled": {
          to: "same",
          periodFrom: "effectiveAt",
          cancelAtPeriodEnd: true,
        },
        "subscription.expired": { to: "expired", clearPeriod: true },
      },
      expired: {
        "subscription.activated": ACTIVATED_ENTRY,
        "payment.succeeded": {
          to: "ignore",
          reason: "stale payment for an expired subscription",
        },
        "payment.failed": {
          to: "ignore",
          reason: "stale retry for an expired subscription",
        },
        "subscription.cancelled": { to: "same" },
        "subscription.expired": { to: "same" },
      },
    });
  });

  it("rejects unknown statuses and event types instead of throwing", () => {
    expect(resolveTransition("suspended" as never, "subscription.activated")).toEqual({
      to: "reject",
      reason: 'unknown subscription status "suspended"',
    });
    expect(resolveTransition("active", "charge.refunded")).toEqual({
      to: "reject",
      reason: 'unknown event type "charge.refunded"',
    });
  });
});
