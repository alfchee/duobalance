// Server-only: account-deletion purge logic extracted for both the HTTP cron
// handler and the Cloudflare scheduled() dispatcher (#269). The route handler
// keeps auth + response shaping; this module owns the DB work.
//
// Purge per confirmed request past its grace deadline:
//   1. anonymize every membership of that user (display_name →
//      'Deleted member', removed_at = now(), removal_reason = 'left') —
//      transactions keep pointing at the same membership ids, so no orphan
//      rows and no balance drift;
//   2. append one deletion_audit_log row per affected household (ids only,
//      never PII);
//   3. mark the request purged.
// Membership rows are never hard-deleted here: entered_by/spent_by are
// ON DELETE RESTRICT, so a cascade would fail loudly instead of orphaning
// the ledger. The auth identity is removed out-of-band once unblocked.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { ANONYMIZED_MEMBER_NAME, ACCOUNT_DELETION_PURGE_CAP } from "@/lib/account-deletion";

export { ACCOUNT_DELETION_PURGE_CAP };

export type PurgeAccountsResult = {
  purgedCount: number;
  users: Array<{ user_id: string; households: string[] }>;
};

export class PurgeAccountsCapError extends Error {
  readonly count: number;
  readonly cap: number;
  readonly code = "SANITY_CAP" as const;

  constructor(count: number, cap: number) {
    super("purge count exceeds sanity cap");
    this.name = "PurgeAccountsCapError";
    this.count = count;
    this.cap = cap;
  }
}

type DueRequest = { id: string; user_id: string };
type Membership = { id: string; household_id: string };

export async function runPurgeAccounts(
  supabase: SupabaseClient<Database>,
): Promise<PurgeAccountsResult> {
  const nowIso = new Date().toISOString();

  const { data: due, error: selectError } = await supabase
    .from("account_deletion_requests")
    .select("id, user_id")
    .eq("status", "confirmed")
    .lt("scheduled_purge_at", nowIso)
    .limit(ACCOUNT_DELETION_PURGE_CAP + 1);

  if (selectError) {
    throw new Error(`lookup failed: ${String(selectError)}`);
  }

  const dueRequests = (due ?? []) as DueRequest[];

  if (dueRequests.length > ACCOUNT_DELETION_PURGE_CAP) {
    throw new PurgeAccountsCapError(dueRequests.length, ACCOUNT_DELETION_PURGE_CAP);
  }

  if (dueRequests.length === 0) {
    return { purgedCount: 0, users: [] };
  }

  const users: PurgeAccountsResult["users"] = [];

  for (const req of dueRequests) {
    const { data: memberships, error: membersError } = await supabase
      .from("household_members")
      .select("id, household_id")
      .eq("user_id", req.user_id);

    if (membersError) {
      throw new Error(`members lookup failed: ${String(membersError)}`);
    }

    const rows = (memberships ?? []) as Membership[];
    const householdIds = [...new Set(rows.map((m) => m.household_id))];

    if (rows.length > 0) {
      const { error: anonError } = await supabase
        .from("household_members")
        .update({
          display_name: ANONYMIZED_MEMBER_NAME,
          removed_at: nowIso,
          removal_reason: "left",
        })
        .eq("user_id", req.user_id)
        .is("removed_at", null);

      if (anonError) {
        throw new Error(`anonymization failed: ${String(anonError)}`);
      }
    }

    for (const householdId of householdIds) {
      const touched = rows.filter((m) => m.household_id === householdId).map((m) => m.id);
      const { error: auditError } = await supabase.from("deletion_audit_log").insert({
        household_id: householdId,
        event_type: "account_deletion_purged",
        target_member_id: touched[0] ?? null,
      });
      if (auditError) {
        throw new Error(`audit failed: ${String(auditError)}`);
      }
    }

    const { error: markError } = await supabase
      .from("account_deletion_requests")
      .update({ status: "purged", purged_at: nowIso })
      .eq("id", req.id);

    if (markError) {
      throw new Error(`mark purged failed: ${String(markError)}`);
    }

    console.info("purge-accounts: purged account deletion request", {
      requestId: req.id,
      households: householdIds.length,
    });
    users.push({ user_id: req.user_id, households: householdIds });
  }

  return { purgedCount: dueRequests.length, users };
}
