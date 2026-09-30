// Admin response allowlist (issues #271–#272). Client-safe — no secrets here.
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
