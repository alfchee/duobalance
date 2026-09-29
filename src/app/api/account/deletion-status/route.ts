// GET /api/account/deletion-status — return the caller's open deletion
// request, if any (#269). Tenancy is the user id itself: callers can only
// ever see their own row (RLS), so there is no cross-household path.

import { createRouteContext, getAuthedUser, HttpError } from "@/app/api/_shared";

export const revalidate = 1;

export async function GET() {
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

  const { data: open, error } = await supabase
    .from("account_deletion_requests")
    .select("id, status, requested_at, confirmed_at, scheduled_purge_at, purged_at")
    .eq("user_id", user.id)
    .in("status", ["pending", "confirmed"])
    .maybeSingle();

  if (error) throw error;
  return Response.json({ request: open ?? null });
}
