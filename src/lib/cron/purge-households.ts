// Server-only: purge logic extracted for both the HTTP cron handler
// and the Cloudflare scheduled() dispatcher (#155). The route handler keeps
// auth + response shaping; this module owns the DB work so scheduled() can
// call it directly without an HTTP round-trip.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export const PURGE_SANITY_CAP = 50;

export type PurgeResult = {
  purgedCount: number;
  households: Array<{ id: string; name: string; deleted_at: string }>;
};

export class PurgeSanityCapError extends Error {
  readonly count: number;
  readonly cap: number;
  readonly code = "SANITY_CAP" as const;

  constructor(count: number, cap: number) {
    super("purge count exceeds sanity cap");
    this.name = "PurgeSanityCapError";
    this.count = count;
    this.cap = cap;
  }
}

export async function runPurgeHouseholds(supabase: SupabaseClient<Database>): Promise<PurgeResult> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: expiredHouseholds, error: selectError } = await supabase
    .from("households")
    .select("id, name, deleted_at")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .limit(PURGE_SANITY_CAP + 1);

  if (selectError) {
    throw new Error(`lookup failed: ${String(selectError)}`);
  }

  const householdsToPurge = expiredHouseholds ?? [];

  if (householdsToPurge.length > PURGE_SANITY_CAP) {
    throw new PurgeSanityCapError(householdsToPurge.length, PURGE_SANITY_CAP);
  }

  if (householdsToPurge.length === 0) {
    return { purgedCount: 0, households: [] };
  }

  const idsToPurge = householdsToPurge.map((h) => h.id);

  console.info("purge-households: purging soft-deleted households (>30 days old)", {
    count: idsToPurge.length,
    ids: idsToPurge,
  });

  const { error: deleteError } = await supabase.from("households").delete().in("id", idsToPurge);

  if (deleteError) {
    throw new Error(`deletion failed: ${String(deleteError)}`);
  }

  return {
    purgedCount: householdsToPurge.length,
    households: householdsToPurge as PurgeResult["households"],
  };
}
