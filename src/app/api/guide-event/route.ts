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
] as const;

const bodySchema = z.object({
  slug: z.string().min(1).max(200),
  anchor: z.string().min(1).max(200).nullable().optional(),
  source: z.enum(GUIDE_SOURCES).nullable().optional(),
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
  const { slug, anchor, source } = parsed.data;

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

  // Resolve household/member via active membership — optional, best-effort.
  // Best-effort: picks earliest household for multi-household users. Prefer active household
  // via header/cookie when available; otherwise earliest joined. See column comment.
  let householdId: string | null = null;
  let memberId: string | null = null;
  try {
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
