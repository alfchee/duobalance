// /api/cron/fx-refresh — daily FX rate population (#17), fired by the Vercel
// cron job (vercel.json). Vercel cron jobs send an HTTP GET and cannot set an
// Authorization header, so this endpoint authenticates on Vercel's documented
// `vercel-cron/1.0` user agent, or a matching Bearer CRON_SECRET for manual
// runs. POST is also accepted (same code path) for secret-triggered scripts.
//
// `dynamic = "force-static"` satisfies the Tauri static-export build
// (`BUILD_TARGET=tauri`), which rejects GET route handlers that don't declare
// it. On the Vercel web build that declaration is overridden by the handler
// reading `request.headers` — Next then serves the route as a live dynamic
// function (verified: it exports as `ƒ Dynamic` in the web build), which is
// what the cron needs. The Tauri build-time prerender bakes an unauthorized
// 401, which is harmless because the desktop app never calls this endpoint.

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { runFxRefresh } from "@/lib/fx/refresh";

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
    const result = await runFxRefresh(supabase);
    return Response.json(result);
  } catch {
    return Response.json({ error: "fx refresh failed" }, { status: 502 });
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return true;
  return request.headers.get("user-agent") === "vercel-cron/1.0";
}
