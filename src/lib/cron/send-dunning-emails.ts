// Server-only: dunning dispatch extracted for #265 so both the HTTP route
// handler and the Cloudflare scheduled() dispatcher can call the same
// business logic without an HTTP round-trip to self. Pattern matches
// send-bill-reminders.ts.
//
// The function takes a service-role Supabase client (cross-household reads)
// and returns the same shape the HTTP handler returns directly. All env
// reads (RESEND via the email module, APP_URL for the manage link) happen
// at call time so the Worker can populate process.env before invoking this.

import type { SupabaseClient } from "@supabase/supabase-js";
import { systemClock, type Clock } from "@/lib/billing/clock";
import { runDunningJob, type DunningJobResult, type DunningRecipient } from "@/lib/billing/dunning";
import { sendDunningEmail } from "@/lib/dunning-email";
import type { Database } from "@/lib/supabase/types";

function manageUrl(): string {
  const base = process.env.APP_URL;
  if (!base) {
    throw new Error("APP_URL is not set — cannot build the dunning manage link");
  }
  return `${base.replace(/\/$/, "")}/settings`;
}

async function resolveRecipients(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<DunningRecipient | null> {
  const { data: household, error: householdError } = await supabase
    .from("households")
    .select("name")
    .eq("id", householdId)
    .maybeSingle();
  if (householdError) {
    throw new Error(`household lookup failed: ${String(householdError)}`);
  }
  const householdName = (household as { name?: string } | null)?.name ?? "tu hogar";

  const { data: members, error: membersError } = await supabase
    .from("household_members")
    .select("id, user_id, display_name")
    .eq("household_id", householdId)
    .is("removed_at", null);
  if (membersError) {
    throw new Error(`member lookup failed: ${String(membersError)}`);
  }
  const list = (members ?? []) as Array<{ id: string; user_id: string; display_name: string }>;
  if (list.length === 0) {
    return null;
  }

  const { data: emailRows, error: emailError } = await supabase.rpc("get_user_emails_batch", {
    p_user_ids: list.map((m) => m.user_id),
  });
  if (emailError) {
    throw new Error(`email lookup failed: ${String(emailError)}`);
  }
  const to = ((emailRows ?? []) as Array<{ email: string }>)
    .map((row) => row.email)
    .filter((email) => !!email);
  if (to.length === 0) {
    return null;
  }

  return {
    to,
    memberName: list[0]?.display_name ?? householdName,
    householdName,
    manageUrl: manageUrl(),
  };
}

export async function runSendDunningEmails(
  supabase: SupabaseClient<Database>,
  clock: Clock = systemClock,
): Promise<DunningJobResult> {
  if (!process.env.RESEND_API_KEY) {
    console.error("send-dunning-emails: RESEND_API_KEY not configured — aborting");
    throw new Error("RESEND_API_KEY not configured");
  }
  return runDunningJob(supabase, clock, {
    resolveRecipients: (householdId) => resolveRecipients(supabase, householdId),
    sendStageEmail: (input) => sendDunningEmail(input),
  });
}
