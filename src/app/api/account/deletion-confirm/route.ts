// POST /api/account/deletion-confirm — step 2 of account deletion (#269).
// Body: { email }. The typed email must match the authenticated user's email
// (explicit confirmation). Moves a pending request to confirmed and starts
// the 30-day grace clock (scheduled_purge_at). Cancellable until purged.

import { z } from "zod";
import { createRouteContext, getAuthedUser, HttpError } from "@/app/api/_shared";
import { scheduledPurgeAt } from "@/lib/account-deletion";
import { tryAudit } from "../_shared";

export const revalidate = 1;

const bodySchema = z.object({ email: z.string().trim().min(1) });

export async function POST(request: Request) {
  if (process.env.BUILD_TARGET === "tauri") {
    return Response.json({ error: "unavailable" }, { status: 401 });
  }
  if (
    (!process.env.NEXT_PUBLIC_SUPABASE_URL ||
      (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY)) &&
    process.env.NODE_ENV === "production"
  ) {
    return Response.json({ error: "not configured" }, { status: 200 });
  }

  const supabase = await createRouteContext();
  let user;
  try {
    user = await getAuthedUser(supabase);
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: "authentication required" }, { status: error.status });
    }
    throw error;
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const userEmail = (user.email ?? "").toLowerCase();
  if (!userEmail || parsed.data.email.toLowerCase() !== userEmail) {
    return Response.json({ error: "confirmation email does not match" }, { status: 400 });
  }

  const { data: pending, error: pendingError } = await supabase
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
  const { data: confirmed, error: updateError } = await supabase
    .from("account_deletion_requests")
    .update({ status: "confirmed", confirmed_at: nowIso, scheduled_purge_at: scheduledPurgeAt() })
    .eq("id", pending.id)
    .select("id, status, requested_at, confirmed_at, scheduled_purge_at, purged_at")
    .single();

  if (updateError) throw updateError;

  await tryAudit(user.id, "account_deletion_confirmed");

  return Response.json({ request: confirmed });
}
