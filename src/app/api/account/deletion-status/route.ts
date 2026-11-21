// GET /api/account/deletion-status — return the caller's open deletion
// request, if any (#269). Tenancy is the user id itself: callers can only
// ever see their own row (RLS), so there is no cross-household path.

import { requireUser } from "@/app/api/_shared";

export const revalidate = 1;

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { supabase, user } = auth;

  const { data: open, error } = await supabase
    .from("account_deletion_requests")
    .select("id, status, requested_at, confirmed_at, scheduled_purge_at, purged_at")
    .eq("user_id", user.id)
    .in("status", ["pending", "confirmed"])
    .maybeSingle();

  if (error) throw error;
  return Response.json({ request: open ?? null });
}
