import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-static";

type PushSubscriptionTable = {
  select: (columns: string) => {
    eq: (
      column: string,
      value: string,
    ) => {
      maybeSingle: () => Promise<{
        data: { household_id: string; member_id: string } | null;
        error: unknown;
      }>;
    };
  };
  insert: (value: unknown) => Promise<{ error: { code?: string } | null }>;
  update: (value: unknown) => {
    eq: (
      column: string,
      value: string,
    ) => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (column: string, value: string) => Promise<{ error: unknown }>;
      };
    };
  };
  delete: () => {
    eq: (
      column: string,
      value: string,
    ) => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (column: string, value: string) => Promise<{ error: unknown }>;
      };
    };
  };
};

function pushSubscriptions(supabase: Awaited<ReturnType<typeof createSupabaseRouteHandler>>) {
  return supabase.from as unknown as (table: "push_subscriptions") => PushSubscriptionTable;
}

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

export async function POST(request: Request) {
  const parsed = await parseBody(request, subscriptionSchema);
  if (!parsed.success) {
    return Response.json({ error: "invalid push subscription" }, { status: 400 });
  }
  const payload = parsed.data;

  const supabase = await createSupabaseRouteHandler();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: member } = await supabase
    .from("household_members")
    .select("id")
    .eq("id", payload.memberId)
    .eq("household_id", payload.householdId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });

  const subscriptions = pushSubscriptions(supabase)("push_subscriptions");
  const { data: existing, error: existingError } = await subscriptions
    .select("household_id, member_id")
    .eq("endpoint", payload.endpoint)
    .maybeSingle();
  if (existingError) {
    return Response.json({ error: "unable to find push subscription" }, { status: 502 });
  }
  if (
    existing &&
    (existing.member_id !== payload.memberId || existing.household_id !== payload.householdId)
  ) {
    return Response.json({ error: "push subscription belongs to another member" }, { status: 409 });
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
    ? await subscriptions
        .update(values as never)
        .eq("endpoint", payload.endpoint)
        .eq("household_id", payload.householdId)
        .eq("member_id", payload.memberId)
    : await subscriptions.insert(values as never);
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
  const { error } = await pushSubscriptions(supabase)("push_subscriptions")
    .delete()
    .eq("household_id", householdId)
    .eq("member_id", memberId)
    .eq("endpoint", endpoint);
  if (error) return Response.json({ error: "unable to remove push subscription" }, { status: 502 });
  return new Response(null, { status: 204 });
}
