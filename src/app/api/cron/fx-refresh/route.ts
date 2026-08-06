// POST /api/cron/fx-refresh — daily FX rate population (#17).
//
// POST (not GET) so the handler stays a live server function: under
// `output: 'export'` (the Tauri build), GET route handlers are prerendered at
// build time, which would freeze today's rates forever. POST handlers export
// as dynamic modules, exactly like /api/invites.
//
// Authorized for Vercel Cron jobs (user-agent `vercel-cron/1.0` — cron jobs
// cannot set an Authorization header, so Vercel documents the user agent as
// the way to recognize them) or a matching Bearer CRON_SECRET, which lets the
// endpoint be hit manually. Writes use the service role; the client never
// calls this path directly — the Settings manual refresh goes through
// POST /api/fx/refresh instead.

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { runFxRefresh } from "@/lib/fx/refresh";

export async function POST(request: Request) {
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
