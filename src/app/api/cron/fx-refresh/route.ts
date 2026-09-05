// /api/cron/fx-refresh — daily FX rate population (#17), fired by the Vercel
// cron job (vercel.json). When CRON_SECRET is configured in the Vercel project,
// Vercel automatically sends it as `Authorization: Bearer <CRON_SECRET>` on
// every cron invocation, so that header is the primary authentication here and
// is required whenever the secret is set. The vercel-cron/1.0 user agent is a
// spoofable signal, so it is only trusted as a fallback when no CRON_SECRET is
// configured (local/dev). POST is also accepted (same code path) so the
// endpoint can be triggered from scripts with the secret.
//
// `revalidate = 1` (a positive number) satisfies the Tauri static-export build
// (`BUILD_TARGET=tauri`), which requires GET route handlers to declare either
// `dynamic = "force-static"` or a `revalidate > 0`. `dynamic = "force-static"`
// must NOT be used here: Next unconditionally proxies the request to strip
// cookies/headers/searchParams whenever `dynamic === "force-static"`, on every
// real request, not just during static generation (verified against a
// production `next start`) — that would make
// `request.headers.get("authorization")` always null and this route
// permanently return 401. `revalidate = 1` satisfies the same Tauri build
// requirement; reading `request.headers` still makes Next render this fully
// dynamically per-request regardless of the revalidate value.

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { cronDisabledResponse, isCronDisabled } from "@/lib/cron/guard";
import { runFxRefresh } from "@/lib/fx/refresh";

export const revalidate = 1;

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (isCronDisabled()) return cronDisabledResponse("fx-refresh");

  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = await createSupabaseRouteHandler();
  try {
    const result = await runFxRefresh(supabase);
    return Response.json(result);
  } catch (err) {
    console.error("fx refresh failed:", err);
    return Response.json({ error: "fx refresh failed" }, { status: 502 });
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return request.headers.get("authorization") === `Bearer ${secret}`;
  }
  return request.headers.get("user-agent") === "vercel-cron/1.0";
}
