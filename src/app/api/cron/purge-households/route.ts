import { createSupabaseRouteHandler } from "@/lib/supabase/server";

export const revalidate = 1;

export const PURGE_SANITY_CAP = 50;

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = await createSupabaseRouteHandler();
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: expiredHouseholds, error: selectError } = await supabase
      .from("households")
      .select("id, name, deleted_at")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);

    if (selectError) {
      console.error("purge-households: lookup failed", selectError);
      return Response.json({ error: "lookup failed" }, { status: 502 });
    }

    const householdsToPurge = expiredHouseholds ?? [];

    if (householdsToPurge.length > PURGE_SANITY_CAP) {
      console.error("purge-households: sanity cap exceeded", {
        count: householdsToPurge.length,
        cap: PURGE_SANITY_CAP,
      });
      return Response.json(
        {
          error: "purge count exceeds sanity cap",
          count: householdsToPurge.length,
          cap: PURGE_SANITY_CAP,
        },
        { status: 422 },
      );
    }

    if (householdsToPurge.length === 0) {
      console.info("purge-households: no households to purge");
      return Response.json({ purgedCount: 0, households: [] });
    }

    console.info(
      "purge-households: purging soft-deleted households (>30 days old)",
      householdsToPurge,
    );

    const idsToPurge = householdsToPurge.map((h) => h.id);

    const { error: deleteError } = await supabase.from("households").delete().in("id", idsToPurge);

    if (deleteError) {
      console.error("purge-households: deletion failed", deleteError);
      return Response.json({ error: "deletion failed" }, { status: 502 });
    }

    return Response.json({
      purgedCount: householdsToPurge.length,
      households: householdsToPurge,
    });
  } catch (err) {
    console.error("purge-households: unexpected failure", err);
    return Response.json({ error: "purge failed" }, { status: 502 });
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
