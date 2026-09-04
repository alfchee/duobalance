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
    const err = new Error("purge count exceeds sanity cap") as Error & {
      count: number;
      cap: number;
      households: typeof householdsToPurge;
    };
    (err as unknown as { count: number }).count = householdsToPurge.length;
    (err as unknown as { cap: number }).cap = PURGE_SANITY_CAP;
    throw Object.assign(err, {
      count: householdsToPurge.length,
      cap: PURGE_SANITY_CAP,
      code: "SANITY_CAP",
    });
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
