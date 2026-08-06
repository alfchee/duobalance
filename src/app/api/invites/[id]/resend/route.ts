// POST /api/invites/:id/resend — re-send the email with the existing token
// (no new token is generated, per #15). Refreshes expires_at so the resent
// link works for another full window; this also revives an invite that has
// already expired (the UI flags it, and resend is the recovery path — no 410).
// Owner-only and rate-limited like create.

import { z } from "zod";
import { sendInviteEmail } from "@/lib/invite-email";
import {
  createRouteContext,
  getAuthedUser,
  HttpError,
  recordInviteSend,
  requireOwner,
} from "../../_shared";

// Static-export-safe (CLAUDE.md hard rule #5). `force-static` + a placeholder
// param list make this a no-op route file under `output: "export"` (Tauri) —
// the exporter is satisfied without emitting anything for real invite ids.
export const dynamic = "force-static";

// Web-only API route. Under `output: "export"` (Tauri) it is not exported at
// all — a placeholder param list satisfies the exporter without emitting
// anything for real invite ids.
export function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

const paramsSchema = z.object({ id: z.string().uuid() });

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = paramsSchema.parse(await params);

  const supabase = await createRouteContext();
  let user;
  try {
    user = await getAuthedUser(supabase);
  } catch (err) {
    if (err instanceof HttpError)
      return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const { data: invite, error: getError } = await supabase
    .from("household_invites")
    .select("id, household_id, email, token, accepted_at, expires_at")
    .eq("id", id)
    .maybeSingle();

  if (getError) throw getError;
  if (!invite) return Response.json({ error: "invite not found" }, { status: 404 });

  let owner;
  try {
    owner = await requireOwner(supabase, user.id, invite.household_id);
  } catch (err) {
    if (err instanceof HttpError)
      return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  if (invite.accepted_at) {
    return Response.json({ error: "invite already accepted" }, { status: 409 });
  }

  // Refresh the expiry so a resent link is usable for another full window.
  const { error: updateError } = await supabase
    .from("household_invites")
    .update({ expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
    .eq("id", id);
  if (updateError) throw updateError;

  // Count the send against the user's rate-limit quota only after the expiry
  // refresh is durably written — a failed update above would otherwise burn
  // quota for an email that never went out (migration 16's trigger).
  try {
    await recordInviteSend(supabase, user.id);
  } catch (err) {
    if (err instanceof HttpError)
      return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const locale = owner.households?.locale ?? "en";
  try {
    await sendInviteEmail({
      to: invite.email,
      inviterName: owner.display_name,
      householdName: owner.households?.name ?? "duobalance",
      token: invite.token,
      locale,
    });
  } catch {
    return Response.json({ error: "failed to send invite email" }, { status: 502 });
  }

  return Response.json({ id: invite.id }, { status: 200 });
}
