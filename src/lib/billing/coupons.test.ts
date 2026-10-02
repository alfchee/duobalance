import { describe, expect, it } from "vitest";
import { applyCouponDiscount, type Coupon } from "./coupons";

// Discount calculation for coupons (issue #268 AC): unit-tested here,
// enforced in the database by redeem_coupon(). The provider charges
// `total` — it never sees the coupon.

const NIO_100 = { amount: 10000, currency: "NIO" };

const percent = (value: number, duration: Coupon["duration"] = "lifetime"): Coupon => ({
  code: "SAVE20",
  discountType: "percent",
  discountValue: value,
  currency: null,
  duration,
});

const amount = (value: number, currency: string | null = "NIO"): Coupon => ({
  code: "OFF500",
  discountType: "amount",
  discountValue: value,
  currency,
  duration: "first_period",
});

describe("applyCouponDiscount (#268)", () => {
  it("applies a percent discount to the plan price", () => {
    const result = applyCouponDiscount(NIO_100, percent(20));
    expect(result).toEqual({
      original: NIO_100,
      discount: { amount: 2000, currency: "NIO" },
      total: { amount: 8000, currency: "NIO" },
    });
  });

  it("a 100% discount zeroes the price the provider charges", () => {
    const result = applyCouponDiscount(NIO_100, percent(100));
    expect(result.total).toEqual({ amount: 0, currency: "NIO" });
    expect(result.discount).toEqual(NIO_100);
  });

  it("floors a fractional-minor-unit percent down so the discount never exceeds the rate", () => {
    // 10% of 99 minor units = 9.9 -> 9, total 90.
    const result = applyCouponDiscount({ amount: 99, currency: "NIO" }, percent(10));
    expect(result.discount).toEqual({ amount: 9, currency: "NIO" });
    expect(result.total).toEqual({ amount: 90, currency: "NIO" });
  });

  it("applies a fixed-amount discount", () => {
    const result = applyCouponDiscount(NIO_100, amount(500));
    expect(result.total).toEqual({ amount: 9500, currency: "NIO" });
    expect(result.discount).toEqual({ amount: 500, currency: "NIO" });
  });

  it("floors at zero when the amount discount is larger than the price", () => {
    const result = applyCouponDiscount(NIO_100, amount(50000));
    expect(result.total).toEqual({ amount: 0, currency: "NIO" });
    // The reported discount is the EFFECTIVE one: original = discount + total.
    expect(result.discount).toEqual(NIO_100);
  });

  it("floors at zero when the amount discount equals the price", () => {
    const result = applyCouponDiscount(NIO_100, amount(10000));
    expect(result.total).toEqual({ amount: 0, currency: "NIO" });
    expect(result.discount).toEqual(NIO_100);
  });

  it("keeps original = discount + total for every case", () => {
    for (const coupon of [
      percent(1),
      percent(33),
      percent(100),
      amount(1),
      amount(9999),
      amount(99999),
    ]) {
      const result = applyCouponDiscount(NIO_100, coupon);
      expect(result.discount.amount + result.total.amount).toBe(NIO_100.amount);
      expect(result.total.amount).toBeGreaterThanOrEqual(0);
    }
  });

  it("is duration-blind: first_period and lifetime price one period identically", () => {
    // Duration decides WHICH periods are discounted (the caller's job), not
    // the math of one period.
    expect(applyCouponDiscount(NIO_100, percent(20, "first_period"))).toEqual(
      applyCouponDiscount(NIO_100, percent(20, "lifetime")),
    );
  });

  it("rejects an amount coupon whose currency does not match the price", () => {
    expect(() => applyCouponDiscount(NIO_100, amount(500, "USD"))).toThrow(RangeError);
    expect(() => applyCouponDiscount(NIO_100, amount(500, null))).toThrow(RangeError);
  });

  it("rejects out-of-range percents and non-positive amounts", () => {
    expect(() => applyCouponDiscount(NIO_100, percent(0))).toThrow(RangeError);
    expect(() => applyCouponDiscount(NIO_100, percent(101))).toThrow(RangeError);
    expect(() => applyCouponDiscount(NIO_100, amount(0))).toThrow(RangeError);
  });

  it("rejects a percent coupon carrying a currency", () => {
    expect(() => applyCouponDiscount(NIO_100, { ...percent(20), currency: "NIO" })).toThrow(
      RangeError,
    );
  });

  it("rejects a negative plan price", () => {
    expect(() => applyCouponDiscount({ amount: -1, currency: "NIO" }, percent(20))).toThrow(
      RangeError,
    );
  });

  it("rejects a malformed plan price instead of passing invalid Money through", () => {
    // Unknown currency would previously flow into discount/total unchecked.
    expect(() => applyCouponDiscount({ amount: 100, currency: "ABC" }, percent(20))).toThrow();
    // Nullish and fractional prices must not throw a bare TypeError.
    expect(() =>
      applyCouponDiscount(null as unknown as { amount: number; currency: string }, percent(20)),
    ).toThrow();
    expect(() => applyCouponDiscount({ amount: 12.5, currency: "NIO" }, percent(20))).toThrow();
  });

  it("does not alias the caller's price object", () => {
    const price = { amount: 10000, currency: "NIO" };
    const result = applyCouponDiscount(price, percent(20));
    expect(result.original).toEqual(price);
    expect(result.original).not.toBe(price);
  });

  it("prices a zero plan at zero", () => {
    const result = applyCouponDiscount({ amount: 0, currency: "NIO" }, percent(50));
    expect(result.total).toEqual({ amount: 0, currency: "NIO" });
    expect(result.discount).toEqual({ amount: 0, currency: "NIO" });
  });
});
