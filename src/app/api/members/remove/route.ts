import { z } from "zod";
import { createInviteRouteContext, getAuthedUser, HttpError } from "@/app/api/invites/_shared";
import { sendMemberRemovalEmail } from "@/lib/member-removal-email";

const bodySchema = z.object({
  household_id: z.string().uuid(),
  member_id: z.string().uuid(),
  account_disposition: z.record(z.string(), z.enum(["transfer", "joint"])).default({}),
});

export async function POST(request: Request) {
  const { auth, admin } = await createInviteRouteContext();
  try {
    await getAuthedUser(auth);
  } catch (err) {
    if (err instanceof HttpError)
      return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const { household_id, member_id, account_disposition } = parsed.data;

  // Look up target member info before removal
  const { data: targetMember } = await admin
    .from("household_members")
    .select("id, display_name, user_id, households(id, name, locale)")
    .eq("id", member_id)
    .eq("household_id", household_id)
    .maybeSingle();

  if (!targetMember) {
    return Response.json({ error: "not an active member of this household" }, { status: 404 });
  }

  // Get target user email from auth admin API
  const { data: authUserData } = await admin.auth.admin.getUserById(targetMember.user_id);
  const targetEmail = authUserData?.user?.email;

  // Execute removal RPC as the authenticated caller
  const { error: rpcError } = await auth.rpc("remove_member", {
    p_household: household_id,
    p_member: member_id,
    p_account_disposition: account_disposition,
  });

  if (rpcError) {
    const status = rpcError.message.includes("unresolved owned accounts") ? 400 : 403;
    return Response.json({ error: rpcError.message }, { status });
  }

  // Queue/send notification email if target email is available
  if (targetEmail) {
    const household = Array.isArray(targetMember.households)
      ? targetMember.households[0]
      : targetMember.households;
    const householdName = household?.name ?? "duobalance";
    const locale = household?.locale ?? "en";

    try {
      await sendMemberRemovalEmail({
        to: targetEmail,
        memberName: targetMember.display_name,
        householdName,
        householdId: household_id,
        locale,
      });
    } catch (err) {
      console.warn("failed to send member removal email", err);
    }
  }

  return Response.json({ ok: true }, { status: 200 });
}
