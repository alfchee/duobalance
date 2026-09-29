// POST /api/account/deletion-request — open an account deletion request
// (#269). Step 1 of request → confirm (typed email) → 30-day grace → purge.
// A second request while one is pending/confirmed gets 409.

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

  const { data: created, error: insertError } = await supabase
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
