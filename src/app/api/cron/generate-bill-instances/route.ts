// GET /api/cron/generate-bill-instances — nightly bill instance generation (#33).
// Fired by the Vercel cron job (vercel.json). Auth pattern matches fx-refresh.
//
// `dynamic = "force-static"` satisfies the Tauri static-export build.
// On Vercel, reading `request.headers` makes it dynamic at runtime.

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { generateAllInstances } from "@/lib/bill-instances";

export const dynamic = "force-static";

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
    const results = await generateAllInstances(supabase);
    const inserted = Object.values(results).filter((c) => c > 0).length;
    const failed = Object.values(results).filter((c) => c < 0).length;
    return Response.json({ inserted, failed, details: results });
  } catch {
    return Response.json({ error: "instance generation failed" }, { status: 502 });
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return request.headers.get("authorization") === `Bearer ${secret}`;
  }
  return request.headers.get("user-agent") === "vercel-cron/1.0";
}
