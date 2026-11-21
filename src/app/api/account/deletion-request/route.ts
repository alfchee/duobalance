// POST /api/account/deletion-request — open an account deletion request
// (#269). Step 1 of request → confirm (typed email) → 30-day grace → purge.
// A second request while one is pending/confirmed gets 409.
//
// Writes are route-only (no client INSERT grant — the lifecycle belongs to
// these handlers + the DB trigger backstop): the service-role client below
// is explicitly scoped to the caller's user_id on every query.

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
    .select("id, status")
    .eq("user_id", user.id)
    .in("status", ["pending", "confirmed"])
    .maybeSingle();

  if (openError) throw openError;
  if (open) {
    return Response.json(
      { error: "deletion already requested", status: open.status },
      { status: 409 },
    );
  }

  const { data: created, error: insertError } = await admin
    .from("account_deletion_requests")
    .insert({ user_id: user.id })
    .select("id, status, requested_at, confirmed_at, scheduled_purge_at, purged_at")
    .single();

  if (insertError) {
    // Unique-index race: a concurrent request won — report 409, not 500.
    if (String(insertError.message).includes("duplicate") || insertError.code === "23505") {
      return Response.json({ error: "deletion already requested" }, { status: 409 });
    }
    throw insertError;
  }

  await tryAudit(user.id, "account_deletion_requested");

  return Response.json({ request: created }, { status: 201 });
}
