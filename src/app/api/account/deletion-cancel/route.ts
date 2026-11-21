// POST /api/account/deletion-cancel — cancel an open deletion request (#269).
// Works while the request is pending or confirmed (i.e. any time before the
// purge runs). After purging there is nothing to cancel (404).
//
// Writes are route-only (service role scoped to the caller).

import { requireUser } from "@/app/api/_shared";
import { tryAudit } from "../_shared";

export const revalidate = 1;

export async function POST() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { user } = auth;

  const { createSupabaseServiceRoleClient } = await import("@/lib/supabase/server");
  const admin = createSupabaseServiceRoleClient();

  const { data: open, error: openError } = await admin
    .from("account_deletion_requests")
    .select("id")
    .eq("user_id", user.id)
    .in("status", ["pending", "confirmed"])
    .maybeSingle();

  if (openError) throw openError;
  if (!open) {
    return Response.json({ error: "no open deletion request" }, { status: 404 });
  }

  // Conditional write: the row must still be open when the update lands. A
  // concurrent purge (confirmed → purged) between the read above and this
  // write then matches zero rows instead of tripping the transition trigger
  // into a 500 — the caller gets the same 404 as "already gone".
  const { data: cancelled, error: updateError } = await admin
    .from("account_deletion_requests")
    .update({ status: "cancelled" })
    .eq("id", open.id)
    .in("status", ["pending", "confirmed"])
    .select("id, status, requested_at, confirmed_at, scheduled_purge_at, purged_at")
    .maybeSingle();

  if (updateError) {
    if (updateError.code === "23514") {
      return Response.json({ error: "no open deletion request" }, { status: 404 });
    }
    throw updateError;
  }
  if (!cancelled) {
    return Response.json({ error: "no open deletion request" }, { status: 404 });
  }

  await tryAudit(user.id, "account_deletion_cancelled");

  return Response.json({ request: cancelled });
}
