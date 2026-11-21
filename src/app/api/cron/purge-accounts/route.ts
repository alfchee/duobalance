// POST/GET /api/cron/purge-accounts — purge confirmed account deletions past
// their 30-day grace deadline (#269). Bearer secret required unconditionally
// (never the spoofable vercel-cron User-Agent). See runPurgeAccounts for the
// anonymize-not-hard-delete discipline.

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { cronDisabledResponse, isCronDisabled } from "@/lib/cron/guard";
import {
  ACCOUNT_DELETION_PURGE_CAP,
  PurgeAccountsCapError,
  runPurgeAccounts,
} from "@/lib/cron/purge-accounts";

export const revalidate = 1;

export { ACCOUNT_DELETION_PURGE_CAP };

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (isCronDisabled()) return cronDisabledResponse("purge-accounts");

  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = await createSupabaseRouteHandler();
  try {
    const result = await runPurgeAccounts(supabase);
    if (result.purgedCount === 0) {
      console.info("purge-accounts: no accounts to purge");
    }
    return Response.json(result);
  } catch (err) {
    if (err instanceof PurgeAccountsCapError) {
      console.error("purge-accounts: sanity cap exceeded", {
        count: err.count,
        cap: err.cap,
      });
      return Response.json(
        { error: "purge count exceeds sanity cap", count: err.count, cap: err.cap },
        { status: 422 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("lookup failed")) {
      console.error("purge-accounts: lookup failed", err);
      return Response.json({ error: "lookup failed" }, { status: 502 });
    }
    if (message.includes("purge failed")) {
      console.error("purge-accounts: purge step failed", err);
      return Response.json({ error: "purge failed" }, { status: 502 });
    }
    console.error("purge-accounts: unexpected failure", err);
    return Response.json({ error: "purge failed" }, { status: 502 });
  }
}

function isAuthorized(request: Request): boolean {
  // Destructive job — never accept the spoofable vercel-cron/1.0 User-Agent,
  // even in development. A bearer secret is required unconditionally.
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
