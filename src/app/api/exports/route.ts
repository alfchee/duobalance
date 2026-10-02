// POST /api/exports — mint a time-limited unguessable export link (#269).
//
// Body: { householdId, format }. The caller must be an active member of the
// household (otherwise 403 — the flow cannot be triggered against another
// household), and the household's plan must include `export` (402).
// Returns { token, expires_at, url }: the token is a 256-bit hex bearer
// secret valid for 24h; redemption (GET /api/exports/[token]) re-checks
// membership, so a leaked token alone grants nothing to a non-member.

import { requireUser } from "@/app/api/_shared";
import { shouldBypassPlanGating } from "@/lib/billing/enabled";
import { exportLinkBodySchema, EXPORT_LINK_TTL_HOURS, exportLinkUrl } from "./_shared";

export const revalidate = 1;

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { supabase, user } = auth;

  const parsed = exportLinkBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }
  const { householdId, format } = parsed.data;

  // Active-membership check (the repository's definition: removed_at null
  // AND the household not soft-deleted): a member of A asking for B — or
  // for a closed household — gets 403 here, before any link row exists.
  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("id, household_id, households!inner(deleted_at)")
    .eq("user_id", user.id)
    .eq("household_id", householdId)
    .is("removed_at", null)
    .is("households.deleted_at", null)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) {
    return Response.json({ error: "household membership required" }, { status: 403 });
  }

  if (!shouldBypassPlanGating()) {
    const { data: entitled, error: featureError } = await supabase.rpc("has_feature", {
      p_household: householdId,
      p_feature: "export",
    });
    if (featureError) throw featureError;
    if (!entitled) {
      return Response.json({ error: "plan upgrade required" }, { status: 402 });
    }
  }

  // Minting is route-only (no client INSERT grant — RLS cannot express the
  // plan gate, which must stay fail-open while billing is off). The TTL
  // trigger + token CHECK remain as defense in depth.
  const { createSupabaseServiceRoleClient } = await import("@/lib/supabase/server");
  const admin = createSupabaseServiceRoleClient();
  const { data: link, error: insertError } = await admin
    .from("data_export_links")
    .insert({ household_id: householdId, created_by: membership.id, format })
    .select("token, expires_at, format")
    .single();

  if (insertError) throw insertError;

  // Best-effort audit (service role appends; clients cannot). Never fails
  // the export if the audit write hiccups.
  try {
    await admin.from("deletion_audit_log").insert({
      household_id: householdId,
      event_type: "export_link_created",
      actor_member_id: membership.id,
    });
  } catch {
    // Ignored — audit must not break the export path.
  }

  return Response.json(
    {
      token: link.token,
      expires_at: link.expires_at,
      format: link.format,
      url: exportLinkUrl(request.url, link.token),
      expires_in_hours: EXPORT_LINK_TTL_HOURS,
    },
    { status: 201 },
  );
}
