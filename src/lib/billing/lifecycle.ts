import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, systemClock, type Clock } from "./clock";
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
// and row CRUD around the planner. expireDueSubscriptions is the sweeper the
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
export const DUNNING_GRACE_DAYS = 7;

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
 * Apply one provider event idempotently, keyed on
 * billing_events(provider, provider_event_id): the insert is the dedupe
 * gate — a 23505 conflict means this exact delivery was already processed,
 * so the same event twice changes state once. Unknown types, invalid
 * transitions, and malformed dates are RECORDED (event row written, linked
 * to the row when known) and returned as rejected, never thrown, so a mixed
 * batch survives one bad delivery.
 *
 * Takes an injected client: route/cron handlers pass a service-role client
 * (cross-household writes); tests pass fakes. Never throws on domain
 * rejections — only on transport/DB failures.
 */
export async function applyBillingEvent(
  db: BillingClient,
  input: ApplyInput,
  clock: Clock = systemClock,
): Promise<ApplyOutcome> {
  const found = await db
    .from("subscriptions")
    .select(
      "id,household_id,plan_code,provider,provider_ref,status,trial_ends_at,current_period_end,grace_ends_at,cancel_at_period_end",
    )
    .eq("provider", input.provider)
    .eq("provider_ref", input.event.ref)
    .maybeSingle();
  if (found.error) {
    throw found.error;
  }
  const row = (found.data ?? null) as SubscriptionRow | null;

  const logged = await db.from("billing_events").insert({
    provider: input.provider,
    provider_event_id: input.providerEventId,
    subscription_id: row?.id ?? null,
    type: input.event.type,
    payload: JSON.parse(JSON.stringify(input.event)) as Json,
    processed_at: clock.now().toISOString(),
  });
  if (logged.error) {
    // Exact redelivery of an already-processed provider event: the first
    // delivery's outcome (applied or recorded rejection) stands; touch
    // nothing, so the same event twice changes state once.
    if (logged.error.code === "23505") {
      return { outcome: "duplicate" };
    }
    throw logged.error;
  }

  // Planning runs AFTER the event row is recorded, and its throws are
  // captured into rejections: a malformed delivery (e.g. a null periodEnd
  // in a JSON-shaped webhook) must surface as a recorded rejection, never
  // as a throw that turns the retry into a silent "duplicate".
  let plan: PlanOutcome;
  try {
    plan = row
      ? planEventApplication(row, input.event, null, clock)
      : planEventApplication(null, input.event, input.householdId ?? null, clock);
  } catch (error) {
    return {
      outcome: "rejected",
      reason: error instanceof Error ? error.message : "unplannable event",
    };
  }

  if (plan.outcome === "ignored") {
    return { outcome: "ignored", reason: plan.reason };
  }
  if (plan.outcome === "rejected") {
    return { outcome: "rejected", reason: plan.reason };
  }
  if (plan.outcome === "create") {
    // The plan code must exist or the FK throws mid-batch: check first so
    // a bogus code is a recorded rejection, not a 500 redelivery loop.
    const planRow = await db
      .from("plans")
      .select("code")
      .eq("code", plan.insert.plan_code)
      .maybeSingle();
    if (planRow.error) {
      throw planRow.error;
    }
    if (!planRow.data) {
      return { outcome: "rejected", reason: `unknown plan code "${plan.insert.plan_code}"` };
    }
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
          return { outcome: "rejected", reason: "household already holds a live subscription" };
        }
        return { outcome: "duplicate" };
      }
      throw created.error;
    }
    await linkEvent(db, input, created.data.id);
    return { outcome: "applied", status: plan.status };
  }

  const updated = await db
    .from("subscriptions")
    .update(plan.update)
    .eq("id", (row as SubscriptionRow).id);
  if (updated.error) {
    throw updated.error;
  }
  return { outcome: "applied", status: plan.status };
}

/** Backfill the event row's subscription link once the row id is known. */
async function linkEvent(db: BillingClient, input: ApplyInput, subscriptionId: string) {
  const linked = await db
    .from("billing_events")
    .update({ subscription_id: subscriptionId })
    .eq("provider", input.provider)
    .eq("provider_event_id", input.providerEventId);
  if (linked.error) {
    throw linked.error;
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
  for (const row of due) {
    const updated = await db
      .from("subscriptions")
      .update({ status: "expired", current_period_end: null })
      .eq("id", row.id);
    if (updated.error) {
      throw updated.error;
    }
  }
  return { checked: rows.length, expired: due.map((row) => row.id) };
}
