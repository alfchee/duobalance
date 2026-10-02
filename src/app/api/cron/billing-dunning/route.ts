import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { isBillingEnabled } from "@/lib/billing/enabled";
import { systemClock } from "@/lib/billing/clock";
import { cronDisabledResponse, isCronDisabled } from "@/lib/cron/guard";
import { runSendDunningEmails } from "@/lib/cron/send-dunning-emails";

// /api/cron/billing-dunning — send one dunning email per stage to
// past_due/grace subscriptions (#265). Cross-household reads, so it runs on
// the service role behind the cron secret (same privilege pattern as
// billing-expire). Idempotent via the dunning_deliveries UNIQUE
// (subscription_id, stage) guard: a second run in the same minute sends
// nothing new. Comped plans are never touched.
//
// Reachability, in order:
//   1. CRON_DISABLED → 200 no-op (rollback guard, same as every cron).
//   2. Flag off → 404 (dunning emails are user-visible; while billing is
//      off there is nothing to dun — same precedent as the webhook route).
//   3. Auth → 401 without the cron secret (production).
//
// `revalidate = 1` satisfies the Tauri static-export build without stripping
// auth headers (same precedent as billing-expire).

export const revalidate = 1;

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (isCronDisabled()) return cronDisabledResponse("billing-dunning");

  if (!isBillingEnabled()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const result = await runSendDunningEmails(supabase, systemClock);
    return Response.json(result);
  } catch (err) {
    console.error("billing dunning failed:", err);
    return Response.json({ error: "billing dunning failed" }, { status: 502 });
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return request.headers.get("authorization") === `Bearer ${secret}`;
  }
  // No secret configured — local-dev convenience only. Never allow the
  // spoofable vercel-cron header in production.
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return request.headers.get("user-agent") === "vercel-cron/1.0";
}
