import type { SupabaseClient } from "@supabase/supabase-js";
import type { Clock } from "./clock";
import { DAY_MS } from "./clock";
import {
  COMPED_PLAN_CODE,
  DUNNING_SCHEDULE,
  type DunningStage,
  type DunningStatus,
} from "./dunning-schedule";
import type { Database } from "@/lib/supabase/types";

// Dunning and grace-period logic with emails (issue #265, parent epic #255).
//
// This is the sequence between a failed payment and losing access: the retry
// attempts, the grace window, and the emails at each stage. The lifecycle
// state machine (#260) moves rows past_due → grace → expired; this module
// decides WHICH email each row is owed and records every send in
// dunning_deliveries. The schedule itself (stages, grace length, claim
// lease) lives in dunning-schedule.ts — the one tuning surface.
//
// LAYERS: planDunningStages is pure (exhaustively tested with a ManualClock,
// no I/O). runDunningJob adds the delivery ledger and the injected mailer
// around the planner. clearDunningForSubscription is the reactivation
// path's cleanup, invoked by applyBillingEvent (#260) whenever a payment
// restores `active`: a successful payment mid-sequence cancels the
// remaining steps, and a LATER failure starts again at stage 1.
//
// DELIVERY PROTOCOL (claim-first): the UNIQUE (subscription_id, stage) row
// is INSERTed (sent_at NULL) BEFORE the email goes out, so concurrent
// runners elect exactly one owner — the loser re-reads instead of sending.
// (Review on PR #287: send-then-insert let two runners both observe no row
// and both send; the later 23505 only prevented double-recording.) The
// owner delivers to every recipient, then UPDATEs sent_at. A crash between
// claim and send leaves a stale claim the next run adopts (lease in
// DUNNING_SCHEDULE.claimLeaseMinutes), so a stage is retried, never
// suppressed. Residual tradeoff, stated plainly: a crash AFTER delivery but
// BEFORE the sent_at update retries the send on adoption — concurrent
// runners cannot double-send, but a crash mid-flight can, because the
// mailer offers no transactional idempotency.
//
// TIME: every timestamp comes from the injected Clock — never the wall
// clock (boundary locked by eslint + boundary.test.ts). The full
// first-failure → expiry sequence runs in a test in under a second on a
// ManualClock.

export type { DunningStage, DunningStatus };
export { COMPED_PLAN_CODE, DUNNING_SCHEDULE };

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

export interface DunningMemberRecipient {
  to: string;
  memberName: string;
}

export interface DunningHousehold {
  householdName: string;
  manageUrl: string;
  /** One entry per member with a reachable email (personalized sends). */
  recipients: DunningMemberRecipient[];
}

export interface DunningJobDeps {
  /**
   * Resolve who to email for a household. Return null when there is nobody
   * to notify (no members, no emails): the job skips WITHOUT claiming, so
   * a later run retries instead of suppressing the stage forever.
   */
  resolveHousehold: (householdId: string) => Promise<DunningHousehold | null>;
  /** Single stage email to one member (Resend in production, a recorder in tests). */
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

interface DeliveryRow {
  subscription_id: string;
  stage: string;
  claimed_at: string;
  sent_at: string | null;
}

/** A delivered stage suppresses resends; a fresh claim belongs to a live runner. */
function claimState(
  row: DeliveryRow | null | undefined,
  now: Date,
): "absent" | "delivered" | "in_flight" | "stale" {
  if (!row) return "absent";
  if (row.sent_at !== null) return "delivered";
  const claimed = new Date(row.claimed_at).getTime();
  if (Number.isNaN(claimed)) return "stale";
  return now.getTime() - claimed < DUNNING_SCHEDULE.claimLeaseMinutes * 60 * 1000
    ? "in_flight"
    : "stale";
}

/**
 * Run one dunning pass. Idempotent across sequential AND concurrent runs:
 * each (subscription, stage) is claimed before delivery, so a second run in
 * the same minute finds every claim delivered or in flight and sends
 * nothing new. A send failure throws (the cron route maps it to a retryable
 * 502) with the claim left for lease adoption, so the next run retries the
 * stage.
 *
 * Takes an injected client: the cron route passes a service-role client
 * (cross-household reads + writes); tests pass fakes.
 */
export async function runDunningJob(
  db: BillingClient,
  clock: Clock,
  deps: DunningJobDeps,
): Promise<DunningJobResult> {
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
  const ledger = await listDeliveryRows(db, ids);

  for (const row of rows) {
    const now = clock.now();
    const due = planDunningStages(row, now).filter(
      (stage) => claimState(ledger.get(key(row.id, stage)), now) === "absent",
    );
    // Stale claims are adopted below (retry), delivered/in-flight are done.
    const retries = planDunningStages(row, now).filter(
      (stage) => claimState(ledger.get(key(row.id, stage)), now) === "stale",
    );
    const pending = [...due, ...retries];
    if (pending.length === 0) {
      continue;
    }
    const household = await deps.resolveHousehold(row.household_id);
    if (!household || household.recipients.length === 0) {
      skipped.push({
        subscriptionId: row.id,
        householdId: row.household_id,
        reason: "no recipients: stage left unclaimed for a later run",
      });
      continue;
    }
    for (const stage of pending) {
      const owned = await acquireClaim(db, row, stage, ledger, clock);
      if (!owned) {
        continue;
      }
      for (const recipient of household.recipients) {
        await deps.sendStageEmail({
          to: [recipient.to],
          stage,
          memberName: recipient.memberName,
          householdName: household.householdName,
          manageUrl: household.manageUrl,
          graceEndsOn: row.grace_ends_at ?? undefined,
        });
      }
      await completeClaim(db, row.id, stage, clock);
      ledger.set(key(row.id, stage), {
        subscription_id: row.id,
        stage,
        claimed_at: clock.now().toISOString(),
        sent_at: clock.now().toISOString(),
      });
      sent.push({ subscriptionId: row.id, householdId: row.household_id, stage });
    }
  }
  return { checked: rows.length, sent, skipped };
}

function key(subscriptionId: string, stage: string): string {
  return `${subscriptionId}|${stage}`;
}

async function listDeliveryRows(
  db: BillingClient,
  subscriptionIds: string[],
): Promise<Map<string, DeliveryRow>> {
  const ledger = new Map<string, DeliveryRow>();
  if (subscriptionIds.length === 0) {
    return ledger;
  }
  const found = await db
    .from("dunning_deliveries")
    .select("subscription_id,stage,claimed_at,sent_at")
    .in("subscription_id", subscriptionIds);
  if (found.error) {
    throw found.error;
  }
  for (const row of (found.data ?? []) as DeliveryRow[]) {
    ledger.set(key(row.subscription_id, row.stage), row);
  }
  return ledger;
}

/**
 * Claim-first acquire: INSERT the claim; on 23505 re-read the winner's row
 * (delivered → done, in-flight → yield, stale → adopt via compare-and-swap
 * on claimed_at so simultaneous adopters elect exactly one owner).
 * Returns true only when this runner owns the delivery.
 */
async function acquireClaim(
  db: BillingClient,
  row: DunningCandidate,
  stage: DunningStage,
  ledger: Map<string, DeliveryRow>,
  clock: Clock,
): Promise<boolean> {
  const now = clock.now();
  const claimedAt = now.toISOString();
  const inserted = await db.from("dunning_deliveries").insert({
    subscription_id: row.id,
    household_id: row.household_id,
    stage,
    claimed_at: claimedAt,
    sent_at: null,
  });
  if (!inserted.error) {
    ledger.set(key(row.id, stage), {
      subscription_id: row.id,
      stage,
      claimed_at: claimedAt,
      sent_at: null,
    });
    return true;
  }
  if (inserted.error.code !== "23505") {
    throw inserted.error;
  }
  const current = await readDeliveryRow(db, row.id, stage);
  const state = claimState(current, clock.now());
  if (state !== "stale" || !current) {
    // Delivered, in-flight, or (vanishingly rare) rolled back: the next
    // redelivery records fresh. Never send on a lost claim.
    if (current) {
      ledger.set(key(row.id, stage), current);
    }
    return false;
  }
  // Adopt: conditional write on the exact stale claimed_at — simultaneous
  // adopters collide on 0 matched rows instead of both sending.
  const adopted = await db
    .from("dunning_deliveries")
    .update({ claimed_at: claimedAt })
    .eq("subscription_id", row.id)
    .eq("stage", stage)
    .eq("claimed_at", current.claimed_at)
    .select("subscription_id");
  if (adopted.error) {
    throw adopted.error;
  }
  const won = (adopted.data ?? []).length > 0;
  if (won) {
    ledger.set(key(row.id, stage), { ...current, claimed_at: claimedAt });
  }
  return won;
}

async function readDeliveryRow(
  db: BillingClient,
  subscriptionId: string,
  stage: string,
): Promise<DeliveryRow | null> {
  const found = await db
    .from("dunning_deliveries")
    .select("subscription_id,stage,claimed_at,sent_at")
    .eq("subscription_id", subscriptionId)
    .eq("stage", stage)
    .maybeSingle();
  if (found.error) {
    throw found.error;
  }
  return (found.data ?? null) as DeliveryRow | null;
}

/** Mark the owned claim delivered. Only the owner reaches here. */
async function completeClaim(
  db: BillingClient,
  subscriptionId: string,
  stage: DunningStage,
  clock: Clock,
): Promise<void> {
  const completed = await db
    .from("dunning_deliveries")
    .update({ sent_at: clock.now().toISOString() })
    .eq("subscription_id", subscriptionId)
    .eq("stage", stage);
  if (completed.error) {
    throw completed.error;
  }
}

/**
 * Reactivation cleanup: a successful payment mid-sequence restores `active`
 * (via the lifecycle, which invokes this) AND deletes this cycle's delivery
 * rows, cancelling the remaining steps. A LATER failure then starts again
 * at first_reminder instead of finding stale rows and staying silent.
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
