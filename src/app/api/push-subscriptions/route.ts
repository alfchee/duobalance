import { createSupabaseRouteHandler, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { z } from "zod";

// No `dynamic` export: this route only has POST/DELETE handlers, so the Tauri
// static-export build already skips it (nothing to prerender) — see
// cron/fx-refresh/route.ts for why `force-static` must NOT be added here.

const subscriptionSchema = z.object({
  householdId: z.uuid(),
  memberId: z.uuid(),
  endpoint: z.url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().nullable(),
});

const unsubscribeSchema = subscriptionSchema.pick({
  householdId: true,
  memberId: true,
  endpoint: true,
});

async function parseBody<T>(request: Request, schema: z.ZodType<T>) {
  const body = await request.json().catch(() => null);
  return schema.safeParse(body);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function requireOwnMember(
  supabase: Awaited<ReturnType<typeof createSupabaseRouteHandler>>,
  memberId: string,
  householdId: string,
): Promise<Response | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: member } = await supabase
    .from("household_members")
    .select("id")
    .eq("id", memberId)
    .eq("household_id", householdId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });

  return null;
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, subscriptionSchema);
  if (!parsed.success) {
    return Response.json({ error: "invalid push subscription" }, { status: 400 });
  }
  const payload = parsed.data;

  const supabase = await createSupabaseRouteHandler();
  const forbidden = await requireOwnMember(supabase, payload.memberId, payload.householdId);
  if (forbidden) return forbidden;

  // `endpoint` is globally unique (one browser/device push registration can't
  // belong to two accounts at once). RLS scopes reads to the caller's own
  // household, so a registration left behind by a different member (e.g. two
  // partners sharing one browser profile) would be invisible here — use the
  // service role, already gated by the ownership check above, to find and
  // reassign it instead of hitting the unique constraint and returning a
  // permanent, unrecoverable 409.
  const admin = createSupabaseServiceRoleClient();
  const { data: existing, error: existingError } = await admin
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", payload.endpoint)
    .maybeSingle();
  if (existingError) {
    return Response.json({ error: "unable to find push subscription" }, { status: 502 });
  }

  const values = {
    household_id: payload.householdId,
    member_id: payload.memberId,
    endpoint: payload.endpoint,
    p256dh: payload.p256dh,
    auth: payload.auth,
    user_agent: payload.userAgent,
  };
  const { error } = existing
    ? await admin.from("push_subscriptions").update(values).eq("id", existing.id)
    : await admin.from("push_subscriptions").insert(values);
  if (isUniqueViolation(error)) {
    return Response.json({ error: "push subscription already exists" }, { status: 409 });
  }
  if (error) return Response.json({ error: "unable to save push subscription" }, { status: 502 });
  return new Response(null, { status: 204 });
}

export async function DELETE(request: Request) {
  const parsed = await parseBody(request, unsubscribeSchema);
  if (!parsed.success) {
    return Response.json({ error: "invalid push subscription" }, { status: 400 });
  }
  const { householdId, memberId, endpoint } = parsed.data;
  const supabase = await createSupabaseRouteHandler();
  const forbidden = await requireOwnMember(supabase, memberId, householdId);
  if (forbidden) return forbidden;

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("household_id", householdId)
    .eq("member_id", memberId)
    .eq("endpoint", endpoint);
  if (error) return Response.json({ error: "unable to remove push subscription" }, { status: 502 });
  return new Response(null, { status: 204 });
}
