// Server-only: dunning dispatch extracted for #265 so the HTTP route
// handler can call the same business logic without an HTTP round-trip to
// self. Pattern matches send-bill-reminders.ts. (Cloudflare scheduled()
// dispatch for billing crons lands at go-live with the trigger budget —
// see docs/billing-go-live-checklist.md §4. Until then billing jobs are
// Vercel-scheduled like billing-expire.)
//
// The function takes a service-role Supabase client (cross-household reads)
// and returns the same shape the HTTP handler returns directly. All env
// reads (RESEND via the email module, APP_URL for the manage link) happen
// at call time so the Worker can populate process.env before invoking this.

import type { SupabaseClient } from "@supabase/supabase-js";
import { systemClock, type Clock } from "@/lib/billing/clock";
import { runDunningJob, type DunningHousehold, type DunningJobResult } from "@/lib/billing/dunning";
import { sendDunningEmail } from "@/lib/dunning-email";
import type { Database } from "@/lib/supabase/types";

function manageUrl(): string {
  const base = process.env.APP_URL;
  if (!base) {
    throw new Error("APP_URL is not set — cannot build the dunning manage link");
  }
  return `${base.replace(/\/$/, "")}/settings`;
}

async function resolveHousehold(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<DunningHousehold | null> {
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
  const emailByUserId = new Map<string, string>();
  for (const row of (emailRows ?? []) as Array<{ id: string; email: string }>) {
    if (row.email) emailByUserId.set(row.id, row.email);
  }
  // One message per member (review on PR #287): a shared greeting addressed
  // to the first member reads as a bug to everyone else. Members without a
  // reachable email are skipped individually — the rest still get theirs.
  const recipients = list.flatMap((member) => {
    const email = emailByUserId.get(member.user_id);
    return email ? [{ to: email, memberName: member.display_name }] : [];
  });
  if (recipients.length === 0) {
    return null;
  }

  return { householdName, manageUrl: manageUrl(), recipients };
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
    resolveHousehold: (householdId) => resolveHousehold(supabase, householdId),
    sendStageEmail: (input) => sendDunningEmail(input),
  });
}
