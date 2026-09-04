import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { PURGE_SANITY_CAP, runPurgeHouseholds } from "@/lib/cron/purge-households";

export const revalidate = 1;

export { PURGE_SANITY_CAP };

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
    const result = await runPurgeHouseholds(supabase);
    if (result.purgedCount === 0) {
      console.info("purge-households: no households to purge");
    }
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isSanityCap = message.includes("sanity cap");
    const capErr = err as Error & { count?: number; cap?: number };
    if (isSanityCap) {
      console.error("purge-households: sanity cap exceeded", {
        count: capErr.count,
        cap: capErr.cap,
      });
      return Response.json(
        {
          error: "purge count exceeds sanity cap",
          count: capErr.count,
          cap: capErr.cap,
        },
        { status: 422 },
      );
    }
    if (message.includes("lookup failed")) {
      console.error("purge-households: lookup failed", err);
      return Response.json({ error: "lookup failed" }, { status: 502 });
    }
    if (message.includes("deletion failed")) {
      console.error("purge-households: deletion failed", err);
      return Response.json({ error: "deletion failed" }, { status: 502 });
    }
    console.error("purge-households: unexpected failure", err);
    return Response.json({ error: "purge failed" }, { status: 502 });
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
