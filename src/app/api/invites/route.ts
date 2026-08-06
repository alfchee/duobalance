// POST /api/invites — create a pending invite. The first route handler to
// hold third-party secrets (RESEND_API_KEY), per #15. The token is a bearer
// credential: it goes in the email and nowhere else. The response returns
// only the invite id, never the token.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { sendInviteEmail } from "@/lib/invite-email";
import {
  createRouteContext,
  getAuthedUser,
  HttpError,
  recordInviteSend,
  requireOwner,
} from "./_shared";

const bodySchema = z.object({
  household_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(320),
});

export async function POST(request: Request) {
  const supabase = await createRouteContext();
  let user;
  try {
    user = await getAuthedUser(supabase);
  } catch (err) {
    if (err instanceof HttpError)
      return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }
  const { household_id, email } = parsed.data;

  let owner;
  try {
    owner = await requireOwner(supabase, user.id, household_id);
  } catch (err) {
    if (err instanceof HttpError)
      return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  try {
    await recordInviteSend(supabase, user.id);
  } catch (err) {
    if (err instanceof HttpError)
      return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  // Replace any existing un-accepted invite for the same (household, email),
  // then insert the fresh one. Two statements — a crash between them leaves
  // the old invite in place, which is recoverable (revoke/resend), so no
  // transaction is needed. A failed delete can't be ignored: proceeding would
  // leave two pending invites for the same (household, email) and the old
  // token would still work, so abort the whole create.
  const { error: deleteError } = await supabase
    .from("household_invites")
    .delete()
    .eq("household_id", household_id)
    .eq("email", email)
    .is("accepted_at", null);

  if (deleteError) {
    return Response.json({ error: "failed to create invite" }, { status: 500 });
  }

  const token = randomBytes(32).toString("base64url");
  const { data: invite, error: insertError } = await supabase
    .from("household_invites")
    .insert({
      household_id,
      email,
      token,
      role: "partner",
      invited_by: owner.id,
    })
    .select("id")
    .single();

  if (insertError || !invite) {
    return Response.json({ error: "failed to create invite" }, { status: 500 });
  }

  const locale = owner.households?.locale ?? "en";
  try {
    await sendInviteEmail({
      to: email,
      inviterName: owner.display_name,
      householdName: owner.households?.name ?? "duobalance",
      token,
      locale,
    });
  } catch {
    // The invite row exists but the email never went out — revoke it so a
    // dangling, unreachable invite can't pile up; the caller can retry.
    await supabase.from("household_invites").delete().eq("id", invite.id);
    return Response.json({ error: "failed to send invite email" }, { status: 502 });
  }

  return Response.json({ id: invite.id }, { status: 201 });
}
