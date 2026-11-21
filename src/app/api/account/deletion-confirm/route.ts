// POST /api/account/deletion-confirm — step 2 of account deletion (#269).
// Body: { email }. The typed email must match the authenticated user's email
// (explicit confirmation). Moves a pending request to confirmed and starts
// the 30-day grace clock (scheduled_purge_at). Cancellable until purged.
//
// Writes are route-only (service role scoped to the caller); the DB trigger
// backstops the transition and the 29–31 day grace window.

import { z } from "zod";
import { requireUser } from "@/app/api/_shared";
import { scheduledPurgeAt } from "@/lib/account-deletion";
import { tryAudit } from "../_shared";

export const revalidate = 1;

const bodySchema = z.object({ email: z.string().trim().min(1) });

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { user } = auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const userEmail = (user.email ?? "").toLowerCase();
  if (!userEmail || parsed.data.email.toLowerCase() !== userEmail) {
    return Response.json({ error: "confirmation email does not match" }, { status: 400 });
  }

  const { createSupabaseServiceRoleClient } = await import("@/lib/supabase/server");
  const admin = createSupabaseServiceRoleClient();

  const { data: pending, error: pendingError } = await admin
    .from("account_deletion_requests")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  if (pendingError) throw pendingError;
  if (!pending) {
    return Response.json({ error: "no pending deletion request" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  // Conditional write (same race as deletion-cancel): the row must still be
  // pending when the update lands, otherwise a concurrent cancel/purge
  // surfaces as 404 instead of a trigger 500.
  const { data: confirmed, error: updateError } = await admin
    .from("account_deletion_requests")
    .update({ status: "confirmed", confirmed_at: nowIso, scheduled_purge_at: scheduledPurgeAt() })
    .eq("id", pending.id)
    .eq("status", "pending")
    .select("id, status, requested_at, confirmed_at, scheduled_purge_at, purged_at")
    .maybeSingle();

  if (updateError) {
    if (updateError.code === "23514") {
      return Response.json({ error: "no pending deletion request" }, { status: 409 });
    }
    throw updateError;
  }
  if (!confirmed) {
    return Response.json({ error: "no pending deletion request" }, { status: 404 });
  }

  await tryAudit(user.id, "account_deletion_confirmed");

  return Response.json({ request: confirmed });
}
