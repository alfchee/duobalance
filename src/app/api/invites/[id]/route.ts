// DELETE /api/invites/:id — revoke a pending invite. Only the household
// owner may revoke, and only while the invite is still un-accepted.

import { z } from "zod";
import { createInviteRouteContext, getAuthedUser, HttpError, requireOwner } from "../_shared";

// Web-only API route. Under `output: "export"` (Tauri) it is not exported at
// all — a placeholder param list satisfies the exporter without emitting
// anything for real invite ids.
export function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

const paramsSchema = z.object({ id: z.string().uuid() });

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = paramsSchema.parse(await params);

  const { auth, admin } = await createInviteRouteContext();
  let user;
  try {
    user = await getAuthedUser(auth);
  } catch (err) {
    if (err instanceof HttpError)
      return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const { data: invite, error: getError } = await admin
    .from("household_invites")
    .select("household_id, accepted_at")
    .eq("id", id)
    .maybeSingle();

  if (getError) throw getError;
  if (!invite) return Response.json({ error: "invite not found" }, { status: 404 });

  try {
    await requireOwner(admin, user.id, invite.household_id);
  } catch (err) {
    if (err instanceof HttpError)
      return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  if (invite.accepted_at) {
    return Response.json({ error: "invite already accepted" }, { status: 409 });
  }

  const { error: deleteError } = await admin.from("household_invites").delete().eq("id", id);
  if (deleteError) throw deleteError;

  return new Response(null, { status: 204 });
}
