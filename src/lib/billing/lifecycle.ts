import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, systemClock, type Clock } from "./clock";
import { clearDunningForSubscription } from "./dunning";
import { DUNNING_GRACE_DAYS } from "./dunning-schedule";
import { isMoney } from "./money";
import type { BillingEvent } from "./provider";
import type { Database, Json } from "@/lib/supabase/types";

// Subscription lifecycle state machine (issue #260, parent epic #255).
//
// Consumes only BillingEvent (#258) and knows nothing about providers —
// identical whether the stub (#259) or a future real adapter feeds it. The
// transition table below is DATA (per the issue notes: nested if-chains age
// badly), mirroring the diagram:
//
//                  ┌──────────────────────────────────────────┐
//                  ▼                                          │
//   (none) ──► trialing ──► active ──► past_due ──► grace ──► expired
//                  │           │          │           │
//                  │           ▼          ▼           ▼
//                  └──────► cancelled ◄───┴───────────┘
//                               │
//                               └──► (reactivate) ──► active
//
//   Entitled:     trialing, active, past_due, grace, cancelled (until period end)
//   Not entitled: expired
//
// The entitled-status list lives in household_plan() and the partial unique
// index (#257) — this module never re-encodes it, it only moves rows between
// statuses those lists already agree on.
//
// LAYERS: resolveTransition + planEventApplication are pure (exhaustively
// tested without I/O). applyBillingEvent adds the billing_events dedupe gate
// and row CRUD around the planner, plus the #265 recovery cleanup (a
// recovery to `active` clears the dunning cycle's delivery rows so the next
// failure restarts at stage 1). expireDueSubscriptions is the sweeper the
// cron route drives. Unknown transitions and unknown event types are
// RECORDED (billing_events row) and returned as rejected — never thrown —
// so a worker processing a mixed batch survives one bad delivery.

export type LifecycleStatus =
  "trialing" | "active" | "past_due" | "grace" | "cancelled" | "expired";

/** "none" = no subscription row yet for this provider ref. */
export type LifecycleFrom = LifecycleStatus | "none";

export const KNOWN_EVENT_TYPES = [
  "subscription.activated",
  "payment.succeeded",
  "payment.failed",
  "subscription.cancelled",
  "subscription.expired",
] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

/** Dunning window granted whenever a subscription enters past_due/grace. */
export { DUNNING_GRACE_DAYS };

interface TransitionDef {
  /** "same" keeps the status (harmless rewrite); "ignore" skips the update. */
  to: LifecycleStatus | "same" | "ignore" | "reject";
  reason?: string;
  /** Copy the event's date field into current_period_end. */
  periodFrom?: "periodEnd" | "effectiveAt";
  /** Null current_period_end on entry (no live period left). */
  clearPeriod?: boolean;
  /** Set grace_ends_at = now + DUNNING_GRACE_DAYS (check constraint needs it). */
  refreshGrace?: boolean;
  /** Clear grace_ends_at on recovery. */
  clearGrace?: boolean;
  /** Write cancel_at_period_end (true on cancel, false on recovery). */
  cancelAtPeriodEnd?: boolean;
  /** Creation-only: seed trial_ends_at from the activation period end. */
  seedTrial?: boolean;
  /**
   * Copy the activation's planCode into plan_code. Only subscription.activated
   * carries a plan — reactivation with a different plan (upgrade/downgrade)
   * must move the row, or household_plan() keeps resolving the stale plan.
   */
  takePlanCode?: boolean;
}

type TransitionTable = Record<LifecycleFrom, Record<string, TransitionDef>>;

const reject = (reason: string): TransitionDef => ({ to: "reject", reason });

const REJECT_NO_ROW = (type: string): TransitionDef =>
  reject(`no subscription row for ${type}: needs a prior subscription.activated`);

const cancelledEntry = (periodFrom: "periodEnd" | "effectiveAt"): TransitionDef => ({
  to: "cancelled",
  periodFrom,
  // Clear the dunning window: household_plan() coalesces grace_ends_at
  // before current_period_end, so a stale grace deadline would keep a
  // cancelled row entitled past its cancellation period.
  clearGrace: true,
  cancelAtPeriodEnd: true,
});

const recoverEntry = (periodFrom: "periodEnd"): TransitionDef => ({
  to: "active",
  periodFrom,
  clearGrace: true,
  cancelAtPeriodEnd: false,
});

/** Activation recovers AND moves the plan (upgrades/downgrades/reactivations). */
const activatedEntry = (): TransitionDef => ({ ...recoverEntry("periodEnd"), takePlanCode: true });

export const TRANSITIONS: TransitionTable = {
  none: {
    "subscription.activated": {
      to: "trialing",
      periodFrom: "periodEnd",
      cancelAtPeriodEnd: false,
      seedTrial: true,
    },
    "payment.succeeded": REJECT_NO_ROW("payment.succeeded"),
    "payment.failed": REJECT_NO_ROW("payment.failed"),
    "subscription.cancelled": REJECT_NO_ROW("subscription.cancelled"),
    "subscription.expired": REJECT_NO_ROW("subscription.expired"),
  },
  trialing: {
    "subscription.activated": activatedEntry(),
    "payment.succeeded": recoverEntry("periodEnd"),
    "payment.failed": { to: "past_due", refreshGrace: true },
    "subscription.cancelled": cancelledEntry("effectiveAt"),
    "subscription.expired": { to: "expired", clearPeriod: true },
  },
  active: {
    "subscription.activated": activatedEntry(),
    "payment.succeeded": recoverEntry("periodEnd"),
    "payment.failed": { to: "past_due", refreshGrace: true },
    "subscription.cancelled": cancelledEntry("effectiveAt"),
    "subscription.expired": { to: "expired", clearPeriod: true },
  },
  past_due: {
    "subscription.activated": activatedEntry(),
    "payment.succeeded": recoverEntry("periodEnd"),
    "payment.failed": { to: "grace", refreshGrace: true },
    "subscription.cancelled": cancelledEntry("effectiveAt"),
    "subscription.expired": { to: "expired", clearPeriod: true },
  },
  grace: {
    "subscription.activated": activatedEntry(),
    "payment.succeeded": recoverEntry("periodEnd"),
    "payment.failed": { to: "expired", clearPeriod: true },
    "subscription.cancelled": cancelledEntry("effectiveAt"),
    "subscription.expired": { to: "expired", clearPeriod: true },
  },
  cancelled: {
    // Reactivation: the only way out of cancelled besides expiry.
    "subscription.activated": activatedEntry(),
    // Terminal precedence (mirrors the stub #259): stale money and stale
    // retries are ignored, never resurrecting.
    "payment.succeeded": { to: "ignore", reason: "stale payment for a cancelled subscription" },
    "payment.failed": { to: "ignore", reason: "stale retry for a cancelled subscription" },
    "subscription.cancelled": { to: "same", periodFrom: "effectiveAt", cancelAtPeriodEnd: true },
    "subscription.expired": { to: "expired", clearPeriod: true },
  },
  expired: {
    "subscription.activated": activatedEntry(),
    "payment.succeeded": { to: "ignore", reason: "stale payment for an expired subscription" },
    "payment.failed": { to: "ignore", reason: "stale retry for an expired subscription" },
    "subscription.cancelled": { to: "same" },
    "subscription.expired": { to: "same" },
  },
};

/** Table lookup with reject fallbacks for unknown types AND unknown statuses. */
export function resolveTransition(from: LifecycleFrom, eventType: string): TransitionDef {
  const byStatus = (TRANSITIONS as Record<string, Record<string, TransitionDef> | undefined>)[from];
  // Unknown status (e.g. a future status the check constraint doesn't know
  // yet reaching this worker): reject, never throw on the lookup.
  if (!byStatus) {
    return { to: "reject", reason: `unknown subscription status "${from}"` };
  }
  return (
    byStatus[eventType] ?? {
      to: "reject",
      reason: `unknown event type "${eventType}"`,
    }
  );
}

export type SubscriptionRow = Pick<
  Database["public"]["Tables"]["subscriptions"]["Row"],
  | "id"
  | "household_id"
  | "plan_code"
  | "provider"
  | "provider_ref"
  | "status"
  | "trial_ends_at"
  | "current_period_end"
  | "grace_ends_at"
  | "cancel_at_period_end"
>;

export type SubscriptionUpdate = Database["public"]["Tables"]["subscriptions"]["Update"];

export type PlanOutcome =
  | { outcome: "applied"; status: LifecycleStatus; update: SubscriptionUpdate }
  | {
      outcome: "create";
      status: LifecycleStatus;
      insert: Database["public"]["Tables"]["subscriptions"]["Insert"];
    }
  | { outcome: "ignored"; reason: string }
  | { outcome: "rejected"; reason: string };

function eventDate(event: BillingEvent, field: "periodEnd" | "effectiveAt"): string {
  const raw =
    event.type === "subscription.cancelled" && field === "effectiveAt"
      ? event.effectiveAt
      : "periodEnd" in event
        ? event.periodEnd
        : null;
  // Tolerant of JSON-shaped deliveries (ISO strings from a raw webhook body),
  // not just in-process Date objects — the worker must not 500 on those.
  // (Explicit null check: new Date(null) silently yields the epoch.)
  if (raw === null || raw === undefined) {
    throw new Error(`event ${event.type} carries no usable ${field}`);
  }
  const value = raw instanceof Date ? raw : new Date(raw as string);
  if (Number.isNaN(value.getTime())) {
    throw new Error(`event ${event.type} carries no usable ${field}`);
  }
  return value.toISOString();
}

/**
 * Pure planner: what should happen to this row (or non-row) for this event.
 * householdId is only needed on the creation path; callers pass it from
 * checkout context (#264 wires that up — until then tests supply it).
 */
export function planEventApplication(
  row: SubscriptionRow | null,
  event: BillingEvent,
  householdId: string | null,
  clock: Clock = systemClock,
): PlanOutcome {
  const from: LifecycleFrom = row ? (row.status as LifecycleStatus) : "none";
  const def = resolveTransition(from, event.type);
  if (def.to === "reject") {
    return { outcome: "rejected", reason: def.reason ?? "rejected transition" };
  }
  if (def.to === "ignore") {
    return { outcome: "ignored", reason: def.reason ?? "stale event" };
  }
  if (event.type === "payment.succeeded" && !isMoney(event.amount)) {
    return { outcome: "rejected", reason: "payment.succeeded carries invalid Money" };
  }
  if (!row) {
    // Creation path: only subscription.activated can open a row (it carries
    // the plan code; payment.succeeded does not — see REJECT_NO_ROW).
    if (event.type !== "subscription.activated") {
      return { outcome: "rejected", reason: def.reason ?? "rejected transition" };
    }
    if (!householdId) {
      return { outcome: "rejected", reason: "new subscription needs a householdId" };
    }
    const periodEnd = eventDate(event, "periodEnd");
    return {
      outcome: "create",
      status: "trialing",
      insert: {
        household_id: householdId,
        plan_code: event.planCode,
        status: "trialing",
        provider_ref: event.ref,
        trial_ends_at: periodEnd,
        current_period_end: periodEnd,
        grace_ends_at: null,
        cancel_at_period_end: false,
      },
    };
  }
  const now = clock.now();
  const update: SubscriptionUpdate = {};
  const to: LifecycleStatus = def.to === "same" ? (row.status as LifecycleStatus) : def.to;
  update.status = to;
  if (def.periodFrom) {
    update.current_period_end = eventDate(event, def.periodFrom);
  }
  if (def.clearPeriod) {
    update.current_period_end = null;
  }
  if (def.refreshGrace) {
    update.grace_ends_at = addDays(now, DUNNING_GRACE_DAYS).toISOString();
  }
  if (def.clearGrace) {
    update.grace_ends_at = null;
  }
  if (def.cancelAtPeriodEnd !== undefined) {
    update.cancel_at_period_end = def.cancelAtPeriodEnd;
  }
  if (def.takePlanCode && event.type === "subscription.activated") {
    update.plan_code = event.planCode;
  }
  return { outcome: "applied", status: to, update };
}

// -- I/O: idempotent application ---------------------------------------------

export type ApplyOutcome =
  | { outcome: "applied"; status: LifecycleStatus }
  | { outcome: "duplicate" }
  | { outcome: "ignored"; reason: string }
  | { outcome: "rejected"; reason: string };

export interface ApplyInput {
  provider: string;
  providerEventId: string;
  event: BillingEvent;
  /** Checkout context for the creation path; omit when the row must exist. */
  householdId?: string;
}

type BillingClient = SupabaseClient<Database>;

/**
 * Thrown when concurrent deliveries keep moving a row under the applier.
 * Callers (the #267 webhook route) should map this to a retryable status
 * (409/503) so the provider redelivers into a quiet moment — never to a
 * silent success, which would drop the delivery.
 */
export class ConcurrentModificationError extends Error {
  constructor(ref: string) {
    super(`concurrent deliveries for subscription "${ref}": retry the event`);
    this.name = "ConcurrentModificationError";
  }
}

/** Bounded optimistic-concurrency laps around read → plan → guarded write. */
const APPLY_ATTEMPTS = 3;

const SUBSCRIPTION_COLUMNS =
  "id,household_id,plan_code,provider,provider_ref,status,trial_ends_at,current_period_end,grace_ends_at,cancel_at_period_end";

async function selectSubscription(
  db: BillingClient,
  provider: string,
  ref: string,
): Promise<SubscriptionRow | null> {
  const found = await db
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("provider", provider)
    .eq("provider_ref", ref)
    .maybeSingle();
  if (found.error) {
    throw found.error;
  }
  return (found.data ?? null) as SubscriptionRow | null;
}

/**
 * Apply one provider event idempotently, keyed on
 * billing_events(provider, provider_event_id). The ledger distinguishes
 * RECEIVED (row present, processed_at null) from PROCESSED: a crash between
 * receipt and state write leaves an unprocessed row that the retry ADOPTS
 * and drives to completion, so a transient failure can never strand a
 * subscription in a state no redelivery will fix. An already-processed id
 * returns `duplicate` with zero state touch — the same event twice changes
 * state once.
 *
 * Unknown types, invalid transitions, and malformed dates are RECORDED
 * (event row written, linked to the row when known) and returned as
 * rejected, never thrown, so a mixed batch survives one bad delivery.
 * Concurrent writers are serialized per row with a conditional update on
 * (id, status) plus a bounded re-plan; exhaustion throws
 * ConcurrentModificationError for the caller to retry.
 *
 * Takes an injected client: route/cron handlers pass a service-role client
 * (cross-household writes); tests pass fakes. Never throws on domain
 * rejections — only on transport/DB failures and write-write races.
 */
export async function applyBillingEvent(
  db: BillingClient,
  input: ApplyInput,
  clock: Clock = systemClock,
): Promise<ApplyOutcome> {
  const row = await selectSubscription(db, input.provider, input.event.ref);

  const logged = await db.from("billing_events").insert({
    provider: input.provider,
    provider_event_id: input.providerEventId,
    subscription_id: row?.id ?? null,
    type: input.event.type,
    payload: JSON.parse(JSON.stringify(input.event)) as Json,
    processed_at: null,
  });
  if (logged.error) {
    if (logged.error.code !== "23505") {
      throw logged.error;
    }
    // Same provider event id seen before: adopt it when a previous attempt
    // recorded receipt but never finished, otherwise it is an exact
    // redelivery whose outcome (applied or recorded rejection) stands.
    // (A null select here means the conflicting writer rolled back; the
    // provider's next redelivery then records fresh — still no double-apply.)
    const prior = await db
      .from("billing_events")
      .select("subscription_id,processed_at")
      .eq("provider", input.provider)
      .eq("provider_event_id", input.providerEventId)
      .maybeSingle();
    if (prior.error) {
      throw prior.error;
    }
    if (!prior.data || prior.data.processed_at !== null) {
      return { outcome: "duplicate" };
    }
  }

  // Activation plan codes are validated on EVERY path, not just creation:
  // a reactivation carrying a bogus code must be a recorded rejection, or a
  // cancelled row could be revived onto a nonexistent plan.
  if (input.event.type === "subscription.activated") {
    const planRow = await db
      .from("plans")
      .select("code")
      .eq("code", input.event.planCode)
      .maybeSingle();
    if (planRow.error) {
      throw planRow.error;
    }
    if (!planRow.data) {
      await markProcessed(db, input, clock);
      return { outcome: "rejected", reason: `unknown plan code "${input.event.planCode}"` };
    }
  }

  // Planning runs AFTER the event row is recorded, and its throws are
  // captured into rejections: a malformed delivery (e.g. a null periodEnd
  // in a JSON-shaped webhook) must surface as a recorded rejection, never
  // as a throw that turns the retry into a silent "duplicate".
  const outcome = await applyPlanned(db, input, row, clock);
  // Recovery cleanup (#265): a payment.succeeded / subscription.activated
  // that restores `active` also deletes the dunning cycle's delivery rows,
  // cancelling the remaining steps. Without this a real payment would leave
  // stale rows behind and a LATER failure would find its first reminder
  // "already sent" and stay silent. Runs before markProcessed so a failed
  // clear leaves the event unprocessed — the provider's redelivery then
  // replays into a quiet moment (the clear itself is an idempotent delete).
  if (
    outcome.result.outcome === "applied" &&
    outcome.result.status === "active" &&
    (input.event.type === "payment.succeeded" || input.event.type === "subscription.activated")
  ) {
    // Update path always has the row; the create path yields trialing (never
    // active), so the fallback is unreachable — guarded anyway, never "".
    const recoveredId = outcome.subscriptionId ?? row?.id;
    if (recoveredId) {
      await clearDunningForSubscription(db, recoveredId);
    }
  }
  await markProcessed(db, input, clock, outcome.subscriptionId ?? undefined);
  return outcome.result;
}

interface SettledOutcome {
  result: ApplyOutcome;
  /** Newly created row id, for the event link backfill. */
  subscriptionId?: string | null;
}

async function applyPlanned(
  db: BillingClient,
  input: ApplyInput,
  row: SubscriptionRow | null,
  clock: Clock,
): Promise<SettledOutcome> {
  let plan: PlanOutcome;
  try {
    plan =
      row !== null
        ? planEventApplication(row, input.event, null, clock)
        : planEventApplication(null, input.event, input.householdId ?? null, clock);
  } catch (error) {
    return {
      result: {
        outcome: "rejected",
        reason: error instanceof Error ? error.message : "unplannable event",
      },
    };
  }

  if (plan.outcome === "ignored") {
    return { result: { outcome: "ignored", reason: plan.reason } };
  }
  if (plan.outcome === "rejected") {
    return { result: { outcome: "rejected", reason: plan.reason } };
  }
  if (plan.outcome === "create") {
    const created = await db
      .from("subscriptions")
      .insert({ ...plan.insert, provider: input.provider })
      .select("id")
      .single();
    if (created.error) {
      // Lost a race (concurrent double-activate) or the household already
      // holds a live row (subscriptions_one_live): both are recorded states,
      // never a 500 loop. Same provider entity → duplicate; a second live
      // row → rejected.
      if (created.error.code === "23505") {
        if ((created.error.message ?? "").includes("subscriptions_one_live")) {
          return {
            result: { outcome: "rejected", reason: "household already holds a live subscription" },
          };
        }
        return { result: { outcome: "duplicate" } };
      }
      throw created.error;
    }
    return {
      result: { outcome: "applied", status: plan.status },
      subscriptionId: created.data.id,
    };
  }

  if (row === null) {
    // Unreachable: the planner only returns applied updates for existing rows.
    throw new Error("lifecycle planner returned an update for a missing row");
  }
  // Optimistic concurrency: the write only lands when the row still holds
  // the planned-from status. A concurrent delivery that moved it first
  // (e.g. a payment landing over a cancellation) matches zero rows instead
  // of resurrecting — then we re-read, re-plan, and retry against fresh
  // state, bounded so a hot row fails loudly instead of spinning.
  for (let attempt = 1; ; attempt += 1) {
    const current =
      attempt === 1 ? row : await selectSubscription(db, input.provider, input.event.ref);
    if (!current) {
      return { result: { outcome: "rejected", reason: "subscription row vanished mid-apply" } };
    }
    let lap: PlanOutcome;
    try {
      lap = planEventApplication(current, input.event, null, clock);
    } catch (error) {
      return {
        result: {
          outcome: "rejected",
          reason: error instanceof Error ? error.message : "unplannable event",
        },
      };
    }
    if (lap.outcome === "ignored") {
      return { result: { outcome: "ignored", reason: lap.reason } };
    }
    if (lap.outcome === "rejected") {
      return { result: { outcome: "rejected", reason: lap.reason } };
    }
    if (lap.outcome !== "applied") {
      // Unreachable: planning against an existing row never returns create.
      throw new Error("lifecycle planner returned create for an existing row");
    }
    const updated = await db
      .from("subscriptions")
      .update(lap.update)
      .eq("id", current.id)
      .eq("status", current.status)
      .select("id");
    if (updated.error) {
      throw updated.error;
    }
    if ((updated.data ?? []).length > 0) {
      return { result: { outcome: "applied", status: lap.status } };
    }
    if (attempt >= APPLY_ATTEMPTS) {
      throw new ConcurrentModificationError(input.event.ref);
    }
  }
}

/** Mark the ledger row processed (and link it when the row id is known). */
async function markProcessed(
  db: BillingClient,
  input: ApplyInput,
  clock: Clock,
  subscriptionId?: string | null,
) {
  const patch: { processed_at: string; subscription_id?: string | null } = {
    processed_at: clock.now().toISOString(),
  };
  if (subscriptionId !== undefined) {
    patch.subscription_id = subscriptionId;
  }
  const marked = await db
    .from("billing_events")
    .update(patch)
    .eq("provider", input.provider)
    .eq("provider_event_id", input.providerEventId);
  if (marked.error) {
    throw marked.error;
  }
}

// -- Sweeper: expire what time has ended ---------------------------------------

export interface ExpirableRow {
  id: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
}

/**
 * Pure expiry predicate: past_due/grace past their grace window, cancelled
 * past (or without) its period end, trialing past its trial end. Active
 * rows are NEVER swept — a lapsed paid period without a failed-payment
 * event is dunning's (#265) call, not the sweeper's. Expired rows are done.
 */
export function isExpirable(row: ExpirableRow, now: Date): boolean {
  if (row.status === "past_due" || row.status === "grace") {
    return row.grace_ends_at !== null && new Date(row.grace_ends_at).getTime() <= now.getTime();
  }
  if (row.status === "cancelled") {
    // Null period end means no entitlement window at all: without this arm a
    // cancelled row with null dates would stay live (household_plan
    // coalesces to infinity) and squat the one-live slot forever.
    return (
      row.current_period_end === null || new Date(row.current_period_end).getTime() <= now.getTime()
    );
  }
  if (row.status === "trialing") {
    return row.trial_ends_at !== null && new Date(row.trial_ends_at).getTime() <= now.getTime();
  }
  return false;
}

export interface ExpireResult {
  checked: number;
  expired: string[];
}

/**
 * Flip every time-ended live subscription to expired. Idempotent: a second
 * run in the same minute selects nothing expirable and updates zero rows.
 * Writes no billing_events rows — that table is provider deliveries only;
 * the status flip itself is the audit trail (updated_at).
 * Each flip is conditional on the read status, so a concurrent event that
 * moved the row first (payment landing mid-sweep) is skipped instead of
 * clobbered — the next run converges.
 */
export async function expireDueSubscriptions(
  db: BillingClient,
  clock: Clock = systemClock,
): Promise<ExpireResult> {
  const now = clock.now();
  const found = await db
    .from("subscriptions")
    .select("id,status,trial_ends_at,current_period_end,grace_ends_at")
    .in("status", ["trialing", "past_due", "grace", "cancelled"]);
  if (found.error) {
    throw found.error;
  }
  const rows = (found.data ?? []) as ExpirableRow[];
  const due = rows.filter((row) => isExpirable(row, now));
  const expired: string[] = [];
  for (const row of due) {
    const updated = await db
      .from("subscriptions")
      .update({ status: "expired", current_period_end: null })
      .eq("id", row.id)
      .eq("status", row.status)
      .select("id");
    if (updated.error) {
      throw updated.error;
    }
    if ((updated.data ?? []).length > 0) {
      expired.push(row.id);
    }
  }
  return { checked: rows.length, expired };
}
