import { z } from "zod";
import { createSupabaseRouteHandler } from "@/lib/supabase/server";

const GUIDE_SOURCES = [
  "balances-empty",
  "budget-empty",
  "bills-empty",
  "first-run",
  "help-center",
  "persistent-help",
  "help-button",
  "members-invite",
  "accept-invite",
  "landing-hero",
  "guide-view",
  "guide-scroll",
  "guide-anchor",
] as const;

const bodySchema = z.object({
  slug: z.string().min(1).max(200),
  anchor: z.string().min(1).max(200).nullable().optional(),
  source: z.enum(GUIDE_SOURCES).nullable().optional(),
  householdId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request) {
  const raw = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.format() },
      { status: 400 },
    );
  }
  const { slug, anchor, source, householdId: requestedHouseholdId } = parsed.data;

  let supabase: Awaited<ReturnType<typeof createSupabaseRouteHandler>>;
  let userId: string;
  try {
    supabase = await createSupabaseRouteHandler();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return Response.json({ error: "authentication required" }, { status: 401 });
    }
    userId = data.user.id;
  } catch {
    return Response.json({ error: "authentication required" }, { status: 401 });
  }

  // Resolve household/member — prefer client-provided active household (localStorage activeHouseholdId)
  // when it belongs to the user, otherwise fallback to earliest-joined. This keeps per-household
  // funnel (#167) accurate for multi-household users.
  let householdId: string | null = null;
  let memberId: string | null = null;
  try {
    // Prefer requested active household if it is a valid membership for this user
    if (requestedHouseholdId) {
      const { data: preferred, error: preferredError } = await supabase
        .from("household_members")
        .select("id, household_id")
        .eq("user_id", userId)
        .eq("household_id", requestedHouseholdId)
        .is("removed_at", null)
        .maybeSingle();
      if (!preferredError && preferred) {
        householdId = preferred.household_id;
        memberId = preferred.id;
      }
    }
    // Fallback: earliest-joined household (header variant also checked)
    if (!householdId) {
      // Also allow header-based active household (e.g. x-active-household) for non-browser clients
      const headerHousehold = request.headers.get("x-active-household");
      if (headerHousehold) {
        const { data: headerMember } = await supabase
          .from("household_members")
          .select("id, household_id")
          .eq("user_id", userId)
          .eq("household_id", headerHousehold)
          .is("removed_at", null)
          .maybeSingle();
        if (headerMember) {
          householdId = headerMember.household_id;
          memberId = headerMember.id;
        }
      }
    }
    if (!householdId) {
      const { data: membership, error: membershipError } = await supabase
        .from("household_members")
        .select("id, household_id")
        .eq("user_id", userId)
        .is("removed_at", null)
        .order("joined_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (membershipError) {
        console.warn("guide_opens membership lookup failed", { userId, error: membershipError });
      } else if (membership) {
        householdId = membership.household_id;
        memberId = membership.id;
      }
    }
  } catch (err) {
    console.warn("guide_opens membership lookup threw", { userId, err });
  }

  const { error: insertError } = await supabase.from("guide_opens").insert({
    household_id: householdId,
    user_id: userId,
    member_id: memberId,
    slug,
    anchor: anchor ?? null,
    source: source ?? null,
  });

  if (insertError) {
    console.error("guide_opens insert error", insertError);
    return Response.json({ error: "failed to record" }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
