import { createSupabaseRouteHandler } from "@/lib/supabase/server";

export const dynamic = "force-static";

type PushSubscriptionTable = {
  upsert: (value: unknown, options: { onConflict: string }) => Promise<{ error: unknown }>;
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

type SubscriptionPayload = {
  householdId: string;
  memberId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as SubscriptionPayload;
  if (
    !payload.householdId ||
    !payload.memberId ||
    !payload.endpoint ||
    !payload.p256dh ||
    !payload.auth
  ) {
    return Response.json({ error: "invalid push subscription" }, { status: 400 });
  }

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

  const { error } = await pushSubscriptions(supabase)("push_subscriptions").upsert(
    {
      household_id: payload.householdId,
      member_id: payload.memberId,
      endpoint: payload.endpoint,
      p256dh: payload.p256dh,
      auth: payload.auth,
      user_agent: payload.userAgent,
    } as never,
    { onConflict: "endpoint" },
  );
  if (error) return Response.json({ error: "unable to save push subscription" }, { status: 502 });
  return new Response(null, { status: 204 });
}

export async function DELETE(request: Request) {
  const { householdId, memberId, endpoint } = (await request.json()) as Pick<
    SubscriptionPayload,
    "householdId" | "memberId" | "endpoint"
  >;
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
