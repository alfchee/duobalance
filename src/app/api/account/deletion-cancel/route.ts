// POST /api/account/deletion-cancel — cancel an open deletion request (#269).
// Works while the request is pending or confirmed (i.e. any time before the
// purge runs). After purging there is nothing to cancel (404).

import { createRouteContext, getAuthedUser, HttpError } from "@/app/api/_shared";
import { tryAudit } from "../_shared";

export const revalidate = 1;

export async function POST() {
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

  const { data: open, error: openError } = await supabase
    .from("account_deletion_requests")
    .select("id")
    .eq("user_id", user.id)
    .in("status", ["pending", "confirmed"])
    .maybeSingle();

  if (openError) throw openError;
  if (!open) {
    return Response.json({ error: "no open deletion request" }, { status: 404 });
  }

  const { data: cancelled, error: updateError } = await supabase
    .from("account_deletion_requests")
    .update({ status: "cancelled" })
    .eq("id", open.id)
    .select("id, status, requested_at, confirmed_at, scheduled_purge_at, purged_at")
    .single();

  if (updateError) throw updateError;

  await tryAudit(user.id, "account_deletion_cancelled");

  return Response.json({ request: cancelled });
}
