import { z } from "zod";
import type { Money } from "./money";

// Coupons and discount codes (issue #268, parent epic #255).
//
// Pure domain logic: the discount is computed against the plan price HERE,
// and the provider is simply told what to charge (`total`). No provider
// type crosses into this module (boundary locked by #258), no I/O, no
// clock reads (boundary locked by #259) — expiry, exhaustion and
// double-redemption are enforced in the database by `redeem_coupon()`,
// which serializes concurrent attempts under a FOR UPDATE lock on the
// coupon row with the UNIQUE (coupon_code, household_id) pair as the
// storage-level backstop.
//
// DURATION (the issue's open question, encoded as a column, not a
// convention): `first_period` means the discount applies once, on the
// first paid period; `lifetime` means it rides every period of the
// subscription. This module prices ONE period — the caller decides which
// periods get the discounted total. Getting this wrong is expensive to
// unwind because it is visible to customers, so the duration travels with
// the coupon and the math below is deliberately duration-blind.

export const couponSchema = z
  .object({
    code: z.string(),
    discountType: z.enum(["percent", "amount"]),
    discountValue: z.number().int(),
    // Percent carries no currency (there is nothing to denominate);
    // amount is denominated in `currency` minor units.
    currency: z.string().nullable(),
    duration: z.enum(["first_period", "lifetime"]),
  })
  .strict();

export type Coupon = z.infer<typeof couponSchema>;

export interface DiscountedPrice {
  /** The plan price before the coupon. */
  readonly original: Money;
  /** The effective discount taken off — never more than `original`. */
  readonly discount: Money;
  /** What the provider is told to charge. Never negative. */
  readonly total: Money;
}

/**
 * Apply a coupon to one period's plan price.
 *
 * - `percent` (1–100): `floor(price * pct / 100)` in minor units, so the
 *   discount never exceeds the stated percentage. 100% yields a zero total.
 * - `amount`: `min(face value, price)` — a coupon larger than the price
 *   floors the total at zero instead of going negative. The reported
 *   `discount` is the EFFECTIVE discount, so `original = discount + total`
 *   always holds.
 * - The coupon currency must match the price currency for `amount`
 *   coupons; `percent` coupons carry none and apply to any currency.
 *
 * @throws {RangeError} On a negative price, an out-of-range percent, a
 * non-positive amount, or a currency mismatch.
 */
export function applyCouponDiscount(planPrice: Money, coupon: Coupon): DiscountedPrice {
  if (!Number.isInteger(planPrice.amount) || planPrice.amount < 0) {
    throw new RangeError(`plan price must be a non-negative integer of minor units`);
  }
  const parsed = couponSchema.parse(coupon);
  const { discountType, discountValue, currency } = parsed;

  if (discountType === "percent") {
    if (discountValue < 1 || discountValue > 100) {
      throw new RangeError(`percent discount must be 1-100 (got ${discountValue})`);
    }
    if (currency !== null) {
      throw new RangeError(`percent coupons carry no currency`);
    }
    const discountAmount = Math.floor((planPrice.amount * discountValue) / 100);
    return {
      original: planPrice,
      discount: { amount: discountAmount, currency: planPrice.currency },
      total: { amount: planPrice.amount - discountAmount, currency: planPrice.currency },
    };
  }

  if (discountValue < 1) {
    throw new RangeError(`amount discount must be at least 1 minor unit`);
  }
  if (currency === null || currency !== planPrice.currency) {
    throw new RangeError(
      `amount coupon currency (${currency ?? "null"}) does not match price currency (${planPrice.currency})`,
    );
  }
  const discountAmount = Math.min(discountValue, planPrice.amount);
  return {
    original: planPrice,
    discount: { amount: discountAmount, currency: planPrice.currency },
    total: { amount: planPrice.amount - discountAmount, currency: planPrice.currency },
  };
}
