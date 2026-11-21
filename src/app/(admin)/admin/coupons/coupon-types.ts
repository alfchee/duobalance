// Shared coupon shapes + pure helpers for the admin coupons screen
// (extracted from page.tsx: coupon-list/detail/forms all use these).
// Types mirror ADMIN_COUPON_KEYS / ADMIN_COUPON_REDEMPTION_KEYS in
// lib/admin/scope.ts; rows are projected server-side, these only type them.

import { formatMoney } from "@/lib/money";

export type AdminCoupon = {
  code: string;
  discount_type: string;
  discount_value: number;
  currency: string | null;
  minor_unit: number | null;
  valid_from: string;
  valid_until: string;
  max_redemptions: number;
  per_household_limit: number;
  duration: string;
  active: boolean;
  created_at: string;
  updated_at: string | null;
  redemption_count: number;
  remaining_capacity: number;
};

export type CouponRedemption = {
  coupon_code: string;
  household_id: string;
  redeemed_at: string;
};

export function discountLabel(c: AdminCoupon): string {
  if (c.discount_type === "percent") return `${c.discount_value}%`;
  // Amounts are stored in minor units — scale by the currency's own
  // minor_unit (never a guessed decimal count) before formatting.
  if (!c.currency) return `${c.discount_value} (minor units)`;
  return formatMoney(c.discount_value / 10 ** (c.minor_unit ?? 2), c.currency);
}

/**
 * Strict whole-number parsing for operator-entered integers. parseInt
 * silently truncates ("20.5" → 20, "20abc" → 20), submitting a different
 * value than entered; here anything but digits is null, so the form stays
 * disabled and the server (zod int + range checks) never sees a mangled
 * value either.
 */
export function parseWholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}
