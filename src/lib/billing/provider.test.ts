import { describe, expect, it } from "vitest";
import { createMoney, isMoney, moneySchema, toMajorUnits, type Money } from "./money";
import {
  InvalidWebhookSignatureError,
  type BillingEvent,
  type ProviderSubscription,
} from "./provider";

describe("billing Money (#258)", () => {
  it("carries an explicit currency, never a bare number", () => {
    const price = createMoney(129, "NIO");
    expect(price).toEqual({ amount: 129, currency: "NIO" });
    expect(isMoney(price)).toBe(true);

    expect(isMoney(129)).toBe(false);
    expect(isMoney({ amount: 129 })).toBe(false);
    expect(isMoney({ amount: 129, currency: "NIO", vendor: "bac" })).toBe(false);
    expect(moneySchema.safeParse({ amount: 12.5, currency: "USD" }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: 350, currency: "usd" }).success).toBe(false);
  });

  it("is not a number alias", () => {
    // @ts-expect-error — Money must never accept a bare number
    const _leak: Money = 12900;
    expect(_leak).toBe(12900);
  });

  it("converts minor units to major units for display", () => {
    expect(toMajorUnits(createMoney(129, "NIO"), 0)).toBe(129);
    expect(toMajorUnits(createMoney(350, "USD"), 2)).toBe(3.5);
    // Negative amounts are credits/refunds reusing the same type.
    expect(toMajorUnits(createMoney(-350, "USD"), 2)).toBe(-3.5);
    expect(() => toMajorUnits(createMoney(350, "USD"), -1)).toThrow(RangeError);
    expect(() => toMajorUnits(createMoney(350, "USD"), 1.5)).toThrow(RangeError);
    expect(() => toMajorUnits(createMoney(350, "USD"), Number.NaN)).toThrow(RangeError);
  });
});

describe("BillingEvent vocabulary (#258)", () => {
  it("covers the five domain events", () => {
    const periodEnd = new Date("2026-10-23T00:00:00Z");
    const events: BillingEvent[] = [
      { type: "subscription.activated", ref: "sub_1", planCode: "plus", periodEnd },
      { type: "payment.succeeded", ref: "sub_1", amount: createMoney(12900, "USD"), periodEnd },
      { type: "payment.failed", ref: "sub_1", attempt: 2 },
      { type: "subscription.cancelled", ref: "sub_1", effectiveAt: periodEnd },
      { type: "subscription.expired", ref: "sub_1" },
    ];
    expect(events).toHaveLength(5);
  });

  it("covers every subscription lifecycle status", () => {
    const statuses: ProviderSubscription["status"][] = [
      "trialing",
      "active",
      "past_due",
      "grace",
      "cancelled",
      "expired",
    ];
    expect(statuses).toHaveLength(6);
  });

  it("webhook failures are InvalidWebhookSignatureError, not empty arrays", () => {
    const err = new InvalidWebhookSignatureError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InvalidWebhookSignatureError");
    expect(err.message).toBe("invalid webhook signature");
  });
});
