import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { cronDisabledResponse, isCronDisabled } from "@/lib/cron/guard";
import {
  PURGE_SANITY_CAP,
  PurgeSanityCapError,
  runPurgeHouseholds,
} from "@/lib/cron/purge-households";

export const revalidate = 1;

export { PURGE_SANITY_CAP };

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (isCronDisabled()) return cronDisabledResponse("purge-households");

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
    if (err instanceof PurgeSanityCapError) {
      console.error("purge-households: sanity cap exceeded", {
        count: err.count,
        cap: err.cap,
      });
      return Response.json(
        {
          error: "purge count exceeds sanity cap",
          count: err.count,
          cap: err.cap,
        },
        { status: 422 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
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
