// Account deletion constants (#269). Client-safe — no secrets here.
//
// Flow: request (pending) → confirm with typed email (confirmed, 30-day
// grace, cancellable) → purge (anonymized + soft-removed, irreversible).
// Purge never hard-deletes membership rows while the ledger references them
// (entered_by/spent_by are ON DELETE RESTRICT); it anonymizes personal
// identifiers in place so the household's books still balance. See
// docs/data-export-deletion.md for the full retention rule.

export const ACCOUNT_DELETION_GRACE_DAYS = 30;

/** display_name written onto memberships at purge time. Not PII. */
export const ANONYMIZED_MEMBER_NAME = "Deleted member";

export const ACCOUNT_DELETION_PURGE_CAP = 50;

export type AccountDeletionStatus = "pending" | "confirmed" | "cancelled" | "purged";

export interface AccountDeletionRequest {
  id: string;
  status: AccountDeletionStatus;
  requested_at: string;
  confirmed_at: string | null;
  scheduled_purge_at: string | null;
  purged_at: string | null;
}

export function scheduledPurgeAt(from: Date = new Date()): string {
  return new Date(from.getTime() + ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
