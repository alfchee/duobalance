// Admin response allowlist (issues #271–#274). Client-safe — no secrets here.
//
// The admin API returns billing state, subscription status and aggregate
// COUNTS only. These key lists are the single definition of that boundary:
// route handlers project every row through them, and boundary.test.ts
// asserts no route file references a forbidden column. If you need a new
// field, add it here AND to the matching DEFINER function in
// supabase/migrations/20260930000002_admin_household_views_272.sql — never inline.
//
// #272 additions: last_activity (latest user-driven timestamp: household
// creation vs newest transaction/account/membership row — billing
// timestamps are on the detail timeline instead). Member email is
// searchable (p_search matches auth.users email) but NEVER returned:
// "email" stays in ADMIN_FORBIDDEN_KEYS.
//
// #273 note: override responses reuse these same allowlists — POST
// /api/admin/households re-reads the detail through the readers above and
// projects through these keys, so no new key was needed here.
//
// #274 additions: coupon + redemption allowlists. Redemption rows carry
// household IDENTIFIERS only (coupon_code, household_id, redeemed_at) —
// emails and names stay forbidden, so support sees who redeemed without
// seeing who they are.
export const ADMIN_COUPON_KEYS = [
  "code",
  "discount_type",
  "discount_value",
  "currency",
  "minor_unit",
  "valid_from",
  "valid_until",
  "max_redemptions",
  "per_household_limit",
  "duration",
  "active",
  "created_at",
  "updated_at",
  "redemption_count",
  "remaining_capacity",
] as const;

export const ADMIN_COUPON_REDEMPTION_KEYS = ["coupon_code", "household_id", "redeemed_at"] as const;

// #275 additions: metrics-dashboard allowlists. Every row is an aggregate
// (counts and labels) — no identifiers, contents, or amounts. The revenue
// section has no DB reader yet (no prices, no provider); the route builds
// its placeholder, so no keys are needed for it here.
export const ADMIN_METRIC_ACTIVATION_KEYS = [
  "signed_up_users",
  "active_households",
  "setup_complete",
  "budget_created",
  "partner_joined",
  "setup_and_partner_joined",
] as const;

export const ADMIN_METRIC_FUNNEL_KEYS = ["step", "name", "reached", "lost_at_step"] as const;

export const ADMIN_METRIC_RETENTION_KEYS = [
  "cohort_week",
  "households",
  "week_2_active",
  "week_2_eligible",
  "week_3_active",
  "week_3_eligible",
  "week_4_active",
  "week_4_eligible",
] as const;

export const ADMIN_METRIC_ARTICLE_KEYS = [
  "slug",
  "views",
  "readers",
  "d25",
  "d50",
  "d75",
  "d100",
] as const;

export const ADMIN_METRIC_SOURCE_KEYS = ["src", "cnt"] as const;

export const ADMIN_METRIC_SUBSCRIPTION_KEYS = ["plan_code", "status", "households"] as const;

export const ADMIN_HOUSEHOLD_KEYS = [
  "household_id",
  "household_name",
  "country",
  "created_at",
  "last_activity",
  "plan_code",
  "subscription_status",
  "current_period_end",
  "grace_ends_at",
  "is_comped",
  "member_count",
  "account_count",
  "transaction_count",
] as const;

export const ADMIN_SUBSCRIPTION_KEYS = [
  "id",
  "plan_code",
  "provider",
  "status",
  "trial_ends_at",
  "current_period_end",
  "grace_ends_at",
  "created_at",
  "updated_at",
] as const;

export const ADMIN_BILLING_EVENT_KEYS = [
  "id",
  "provider",
  "provider_event_id",
  "subscription_id",
  "type",
  "received_at",
  "processed_at",
] as const;

// Columns that must NEVER appear in an admin response. Transaction contents
// (what the household spent), account names, and category names are out of
// scope for support — counts and billing metadata answer the question.
// Locked by src/lib/admin/boundary.test.ts (source scan) and the pgTAP
// suite (data-layer proof).
export const ADMIN_FORBIDDEN_KEYS = [
  "description",
  "amount",
  "merchant",
  "notes",
  "account_name",
  "category",
  "category_id",
  "account_id",
  "payload",
  "opening_balance",
  "email",
] as const;

export type AdminHouseholdKey = (typeof ADMIN_HOUSEHOLD_KEYS)[number];

/** Project one row to the allowlist. Unknown keys are dropped, never passed through. */
export function projectAdminKeys(
  row: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    out[key] = row[key] ?? null;
  }
  return out;
}
