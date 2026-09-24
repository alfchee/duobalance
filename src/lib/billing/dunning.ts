import type { SupabaseClient } from "@supabase/supabase-js";
import type { Clock } from "./clock";
import { DAY_MS } from "./clock";
import { DUNNING_GRACE_DAYS } from "./lifecycle";
import type { Database } from "@/lib/supabase/types";

// Dunning and grace-period logic with emails (issue #265, parent epic #255).
//
// This is the sequence between a failed payment and losing access: the retry
// attempts, the grace window, and the emails at each stage. The lifecycle
// state machine (#260) moves rows past_due → grace → expired; this module
// decides WHICH email each row is owed and records every send in
// dunning_deliveries so a retried job never double-sends.
//
// LAYERS: DUNNING_SCHEDULE + planDunningStages are pure (exhaustively tested
// with a ManualClock, no I/O). runDunningJob adds the delivery ledger and
// the injected mailer around the planner. clearDunningForSubscription is
// the reactivation path's cleanup: a successful payment mid-sequence must
// cancel the remaining steps, so the recovery caller deletes the cycle's
// rows and a LATER failure starts again at stage 1.
//
// TIME: every timestamp comes from the injected Clock — never the wall
// clock (boundary locked by eslint + boundary.test.ts). The full
// first-failure → expiry sequence runs in a test in under a second on a
// ManualClock.

export type DunningStage = "first_reminder" | "second_reminder" | "final_notice";

export const DUNNING_STAGES: readonly DunningStage[] = [
  "first_reminder",
  "second_reminder",
  "final_notice",
];

/** Comped founder households (#263) never enter dunning, full stop. */
export const COMPED_PLAN_CODE = "comped";

export type DunningStatus = "past_due" | "grace";

interface DunningStageRule {
  stage: DunningStage;
  /** Row statuses that make this stage due. */
  onStatuses: readonly DunningStatus[];
  /**
   * When set, the stage is additionally gated on urgency: only due once
   * now >= grace_ends_at - leadDays * DAY_MS (the final notice goes out
   * shortly before expiry, not on grace entry).
   */
  leadDaysBeforeGraceEnd?: number;
}

/**
 * THE schedule (issue notes: "Put the schedule in one place"). Dunning
 * timings get tuned against real failure data later — that tuning edits
 * this object, not constants scattered across files. graceDays mirrors
 * DUNNING_GRACE_DAYS from the lifecycle (#260), the window the sweeper
 * expires against; the stages say who is owed what and when:
 * - first_reminder: on entering past_due (immediate, catch-up in grace).
 * - second_reminder: on entering grace.
 * - final_notice: in grace, once the window is nearly over.
 */
export const DUNNING_SCHEDULE: {
  graceDays: number;
  finalNoticeLeadDays: number;
  stages: readonly DunningStageRule[];
} = {
  graceDays: DUNNING_GRACE_DAYS,
  finalNoticeLeadDays: 2,
  stages: [
    { stage: "first_reminder", onStatuses: ["past_due", "grace"] },
    { stage: "second_reminder", onStatuses: ["grace"] },
    { stage: "final_notice", onStatuses: ["grace"], leadDaysBeforeGraceEnd: 2 },
  ],
};

export interface DunningCandidate {
  id: string;
  household_id: string;
  plan_code: string;
  status: string;
  grace_ends_at: string | null;
}

/**
 * Pure planner: which stages is this row owed RIGHT NOW. Comped plans and
 * non-dunning statuses are owed nothing — recovery (active) therefore
 * cancels the remaining steps by construction, no extra flag needed.
 * A grace row without a grace deadline (violates the dunning_needs_grace_end
 * check, but be tolerant) is treated as urgent: the final notice is due.
 */
export function planDunningStages(row: DunningCandidate, now: Date): DunningStage[] {
  if (row.plan_code === COMPED_PLAN_CODE) {
    return [];
  }
  const due: DunningStage[] = [];
  for (const rule of DUNNING_SCHEDULE.stages) {
    if (!(rule.onStatuses as readonly string[]).includes(row.status)) {
      continue;
    }
    if (rule.leadDaysBeforeGraceEnd !== undefined) {
      if (row.grace_ends_at !== null) {
        const graceEnd = new Date(row.grace_ends_at).getTime();
        if (Number.isNaN(graceEnd)) {
          continue;
        }
        const leadMs = rule.leadDaysBeforeGraceEnd * DAY_MS;
        if (now.getTime() < graceEnd - leadMs) {
          continue;
        }
      }
      // Null deadline: treated as urgent (due) — see docstring.
    }
    due.push(rule.stage);
  }
  return due;
}

// -- I/O: idempotent job -----------------------------------------------------

export interface DunningSent {
  subscriptionId: string;
  householdId: string;
  stage: DunningStage;
}

export interface DunningSkipped {
  subscriptionId: string;
  householdId: string;
  reason: string;
}

export interface DunningJobResult {
  checked: number;
  sent: DunningSent[];
  skipped: DunningSkipped[];
}

export interface DunningRecipient {
  to: string[];
  memberName: string;
  householdName: string;
  manageUrl: string;
}

export interface DunningJobDeps {
  /**
   * Resolve who to email for a household. Return null when there is nobody
   * to notify (no members, no emails): the job skips WITHOUT recording, so
   * a later run retries instead of suppressing the stage forever.
   */
  resolveRecipients: (householdId: string) => Promise<DunningRecipient | null>;
  /** Stage email sender (Resend in production, a recorder in tests). */
  sendStageEmail: (input: {
    to: string[];
    stage: DunningStage;
    memberName: string;
    householdName: string;
    manageUrl: string;
    graceEndsOn?: string;
  }) => Promise<void>;
}

type BillingClient = SupabaseClient<Database>;

const SUBSCRIPTION_COLUMNS = "id,household_id,plan_code,status,grace_ends_at";

/**
 * Run one dunning pass. Idempotent: each (subscription, stage) sends at
 * most once, guarded by the dunning_deliveries UNIQUE (subscription_id,
 * stage) row — a second run in the same minute finds every row and sends
 * nothing. A send failure throws (the cron route maps it to a retryable
 * 502) WITHOUT recording, so the next run retries the stage.
 *
 * Takes an injected client: the cron route passes a service-role client
 * (cross-household reads + writes); tests pass fakes.
 */
export async function runDunningJob(
  db: BillingClient,
  clock: Clock,
  deps: DunningJobDeps,
): Promise<DunningJobResult> {
  const now = clock.now();
  const found = await db
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .in("status", ["past_due", "grace"]);
  if (found.error) {
    throw found.error;
  }
  const rows = (found.data ?? []) as DunningCandidate[];
  const sent: DunningSent[] = [];
  const skipped: DunningSkipped[] = [];

  const ids = rows.map((row) => row.id);
  const already = await listSentStages(db, ids);
  const sentSet = new Set(already.map((entry) => `${entry.subscription_id}|${entry.stage}`));

  for (const row of rows) {
    const due = planDunningStages(row, now).filter((stage) => !sentSet.has(`${row.id}|${stage}`));
    if (due.length === 0) {
      continue;
    }
    const recipient = await deps.resolveRecipients(row.household_id);
    if (!recipient || recipient.to.length === 0) {
      skipped.push({
        subscriptionId: row.id,
        householdId: row.household_id,
        reason: "no recipients: stage left unsent for a later run",
      });
      continue;
    }
    for (const stage of due) {
      if (sentSet.has(`${row.id}|${stage}`)) {
        continue;
      }
      await deps.sendStageEmail({
        to: recipient.to,
        stage,
        memberName: recipient.memberName,
        householdName: recipient.householdName,
        manageUrl: recipient.manageUrl,
        graceEndsOn: row.grace_ends_at ?? undefined,
      });
      const recorded = await recordSent(db, {
        subscription_id: row.id,
        household_id: row.household_id,
        stage,
        sent_at: clock.now().toISOString(),
      });
      // "duplicate" means a concurrent run recorded the same (subscription,
      // stage) first: the email still went out exactly once, so report it
      // as sent either way — never retry the send.
      if (recorded === "duplicate") {
        sentSet.add(`${row.id}|${stage}`);
      }
      sent.push({ subscriptionId: row.id, householdId: row.household_id, stage });
      sentSet.add(`${row.id}|${stage}`);
    }
  }
  return { checked: rows.length, sent, skipped };
}

async function listSentStages(
  db: BillingClient,
  subscriptionIds: string[],
): Promise<Array<{ subscription_id: string; stage: string }>> {
  if (subscriptionIds.length === 0) {
    return [];
  }
  const found = await db
    .from("dunning_deliveries")
    .select("subscription_id,stage")
    .in("subscription_id", subscriptionIds);
  if (found.error) {
    throw found.error;
  }
  return (found.data ?? []) as Array<{ subscription_id: string; stage: string }>;
}

/**
 * Record one send. Returns "duplicate" when a concurrent run recorded the
 * same (subscription, stage) first (23505 on the unique guard) — the email
 * already went out exactly once, so the caller must NOT retry the send.
 */
async function recordSent(
  db: BillingClient,
  input: { subscription_id: string; household_id: string; stage: DunningStage; sent_at: string },
): Promise<"recorded" | "duplicate"> {
  const inserted = await db.from("dunning_deliveries").insert(input);
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      return "duplicate";
    }
    throw inserted.error;
  }
  return "recorded";
}

/**
 * Reactivation cleanup: a successful payment mid-sequence restores `active`
 * (via the lifecycle) AND deletes this cycle's delivery rows, cancelling
 * the remaining steps. A LATER failure then starts again at first_reminder
 * instead of finding stale rows and staying silent. Call this wherever a
 * payment.succeeded / subscription.activated recovery is applied.
 */
export async function clearDunningForSubscription(
  db: BillingClient,
  subscriptionId: string,
): Promise<void> {
  const deleted = await db
    .from("dunning_deliveries")
    .delete()
    .eq("subscription_id", subscriptionId);
  if (deleted.error) {
    throw deleted.error;
  }
}
