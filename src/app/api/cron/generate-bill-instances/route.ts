// GET /api/cron/generate-bill-instances — nightly bill instance generation (#33).
// Fired by the Vercel cron job (vercel.json). Auth pattern matches fx-refresh.
//
// `revalidate = 0` satisfies the Tauri static-export build without Next
// stripping cookies/headers/searchParams from real requests — see
// cron/fx-refresh/route.ts for why `dynamic = "force-static"` must not be used.

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { cronDisabledResponse, isCronDisabled } from "@/lib/cron/guard";
import { generateAllInstances } from "@/lib/bill-instances";

export const revalidate = 1;

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (isCronDisabled()) return cronDisabledResponse("generate-bill-instances");

  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = await createSupabaseRouteHandler();
  try {
    const results = await generateAllInstances(supabase);
    const inserted = Object.values(results).reduce((sum, c) => (c > 0 ? sum + c : sum), 0);
    const failed = Object.values(results).filter((c) => c < 0).length;
    return Response.json({ inserted, failed, details: results });
  } catch (err) {
    console.error("generate-bill-instances: handler failed", err);
    return Response.json({ error: "instance generation failed" }, { status: 502 });
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
