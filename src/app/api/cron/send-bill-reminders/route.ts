// GET /api/cron/send-bill-reminders — daily reminder emails for due bills (#33).
// Fired by the Vercel cron job (vercel.json). Auth pattern matches fx-refresh.
//
// `revalidate = 0` satisfies the Tauri static-export build without Next
// stripping cookies/headers/searchParams from real requests — see
// cron/fx-refresh/route.ts for why `dynamic = "force-static"` must not be used.

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { cronDisabledResponse, isCronDisabled } from "@/lib/cron/guard";
import { runSendBillReminders } from "@/lib/cron/send-bill-reminders";

export const revalidate = 1;

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (isCronDisabled()) return cronDisabledResponse("send-bill-reminders");

  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return Response.json({ error: "RESEND_API_KEY not configured" }, { status: 502 });
  }

  const supabase = await createSupabaseRouteHandler();

  try {
    const result = await runSendBillReminders(supabase);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    // Preserve the specific 502 branches the previous inline handler exposed:
    // missing RESEND already handled above, but keep differentiated logging.
    if (message.includes("RESEND_API_KEY")) {
      return Response.json({ error: "RESEND_API_KEY not configured" }, { status: 502 });
    }
    if (message.includes("failed to mark instances as reminded")) {
      // Extract counts if available — runSendBillReminders throws generic, so
      // the route approximates the previous 502 payload shape for that case.
      console.error("send-bill-reminders: failed to mark reminded_at", err);
      return Response.json({ error: "failed to mark instances as reminded" }, { status: 502 });
    }
    console.error("send-bill-reminders: handler failed", err);
    return Response.json({ error: `reminder sending failed: ${message}` }, { status: 502 });
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
