import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { cronDisabledResponse, isCronDisabled } from "@/lib/cron/guard";
import { systemClock } from "@/lib/billing/clock";
import { expireDueSubscriptions } from "@/lib/billing/lifecycle";

// /api/cron/billing-expire — flip time-ended subscriptions to expired (#260).
// Cross-household writes, so it runs on the service role behind the cron
// secret (same privilege pattern as the invite/members routes: auth here,
// then explicit service-role use). Fired by the Vercel cron job
// (vercel.json); safe to run twice in the same minute — the second run
// selects nothing expirable and updates zero rows.
//
// `revalidate = 1` (a positive number) satisfies the Tauri static-export
// build, same as the other cron routes: `dynamic = "force-static"` must NOT
// be used because Next would strip auth headers on every real request (see
// cron/fx-refresh/route.ts).

export const revalidate = 1;

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (isCronDisabled()) return cronDisabledResponse("billing-expire");

  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const result = await expireDueSubscriptions(supabase, systemClock);
    return Response.json(result);
  } catch (err) {
    console.error("billing expire failed:", err);
    return Response.json({ error: "billing expire failed" }, { status: 502 });
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return request.headers.get("authorization") === `Bearer ${secret}`;
  }
  // No secret configured — local-dev convenience only. Never allow the
  // spoofable vercel-cron header in production, otherwise anyone can set
  // User-Agent and trigger the job.
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return request.headers.get("user-agent") === "vercel-cron/1.0";
}
