// Server-only: account-deletion purge logic extracted for both the HTTP cron
// handler and the Cloudflare scheduled() dispatcher (#269). The route handler
// keeps auth + response shaping; this module owns the DB work.
//
// Each due request is purged by the atomic `purge_account_deletion()` RPC
// (anonymize + audit + mark-purged in one transaction, so a retry can never
// half-apply or duplicate audit rows). Expired export links are swept in the
// same run — links carry no PII and need no audit row.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { ACCOUNT_DELETION_PURGE_CAP } from "@/lib/account-deletion";

export { ACCOUNT_DELETION_PURGE_CAP };

export type PurgeAccountsResult = {
  purgedCount: number;
  users: Array<{ user_id: string; households: string[] }>;
  expiredLinksDeleted: number;
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

export async function runPurgeAccounts(
  supabase: SupabaseClient<Database>,
): Promise<PurgeAccountsResult> {
  const nowIso = new Date().toISOString();

  const { data: due, error: selectError } = await supabase
    .from("account_deletion_requests")
    .select("id")
    .eq("status", "confirmed")
    .lt("scheduled_purge_at", nowIso)
    .limit(ACCOUNT_DELETION_PURGE_CAP + 1);

  if (selectError) {
    throw new Error(`lookup failed: ${String(selectError)}`);
  }

  const dueRequests = ((due ?? []) as Array<{ id: string }>).map((r) => r.id);

  if (dueRequests.length > ACCOUNT_DELETION_PURGE_CAP) {
    throw new PurgeAccountsCapError(dueRequests.length, ACCOUNT_DELETION_PURGE_CAP);
  }

  const users: PurgeAccountsResult["users"] = [];

  for (const requestId of dueRequests) {
    const { data, error: rpcError } = await supabase.rpc("purge_account_deletion", {
      p_request: requestId,
    });

    if (rpcError) {
      throw new Error(`purge failed: ${String(rpcError.message ?? rpcError)}`);
    }

    const result = data as unknown as { user_id: string; households: string[] } | null;
    console.info("purge-accounts: purged account deletion request", {
      requestId,
      households: result?.households.length ?? 0,
    });
    users.push({
      user_id: result?.user_id ?? "",
      households: result?.households ?? [],
    });
  }

  // Best-effort sweep of expired links (no PII, no audit needed). A failure
  // here must not fail the purge run — the next run retries.
  let expiredLinksDeleted = 0;
  try {
    const { error: sweepError, count } = await supabase
      .from("data_export_links")
      .delete({ count: "exact" })
      .lt("expires_at", nowIso);
    if (sweepError) throw sweepError;
    expiredLinksDeleted = count ?? 0;
  } catch (err) {
    console.error("purge-accounts: expired-link sweep failed", err);
  }

  return { purgedCount: dueRequests.length, users, expiredLinksDeleted };
}
