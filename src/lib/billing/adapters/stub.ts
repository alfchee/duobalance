import { addDays, ManualClock, systemClock, type Clock } from "../clock";
import { createMoney } from "../money";
import type { BillingEvent, PaymentProvider, ProviderSubscription } from "../provider";
import { InvalidWebhookSignatureError } from "../provider";

// StubPaymentProvider — the test double that makes the billing epic testable
// with no real provider connected (issue #259, parent epic #255).
//
// STATE: two in-memory local tables (deliberately not a migration — a test
// double must stay ephemeral, deterministic, and free of RLS/tenant
// coupling):
//   - subscriptions keyed by provider ref,
//   - an event log where every entry carries a stub provider event id.
// `parseWebhook` drains a separate outbox of not-yet-delivered entries, so
// redelivery and out-of-order arrival can be simulated exactly like a real
// provider misbehaving.
//
// TIME: every timestamp comes from the injected `Clock` (default
// `systemClock`; tests and the debug surface inject a `ManualClock`). There
// are no lazy time-based transitions — tests drive state explicitly via the
// methods below while advancing the clock to prove the 30-day trial and
// 7-day grace windows compute correctly. Deterministic, no read side-effects.
//
// APPLICATION PRECEDENCE (the stub's model of a faithful consumer, mirrored
// by the production state machine in #260): `cancelled` and `expired` are
// terminal for payment events — a stale `payment.succeeded` arriving after
// `subscription.cancelled` is ignored. Only `subscription.activated`
// reactivates. `injectEvents` is how tests deliver out-of-order arrivals.
//
// Every stub-shaped / vendor-shaped type lives in this directory on purpose:
// it is the fixture the `billing/adapters` import boundary is tested against.

/**
 * Stub-only wire config. Simulates a vendor type: it must never be imported
 * outside `src/lib/billing/adapters/`. The eslint boundary
 * (`eslint.config.mjs`) and `boundary.test.ts` enforce this.
 */
export interface StubVendorConfig {
  readonly signatureHeader: string;
  readonly validSignature: string;
}

const DEFAULT_CONFIG: StubVendorConfig = {
  signatureHeader: "x-stub-signature",
  validSignature: "stub-valid",
};

/** Trial length for a fresh checkout (ADR 0001: 1-month free trial). */
export const STUB_TRIAL_DAYS = 30;
/** Paid period length granted by each successful renewal. */
export const STUB_RENEWAL_DAYS = 30;
/** Dunning window after a failed renewal before expiry pressure. */
export const STUB_GRACE_DAYS = 7;
/** Default renewal charge (ADR 0001 plus-monthly); override per test. */
export const STUB_DEFAULT_AMOUNT_MINOR = 12900;
export const STUB_DEFAULT_CURRENCY = "NIO";

export type StubStatus = ProviderSubscription["status"];

interface StubSubscription {
  ref: string;
  householdId: string;
  planCode: string;
  status: StubStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  failures: number;
}

export interface StubLoggedEvent {
  readonly id: string;
  readonly event: BillingEvent;
}

export interface StubRenewalOptions {
  readonly amountMinor?: number;
  readonly currency?: string;
}

export interface StubInjectSummary {
  readonly applied: number;
  readonly ignored: number;
}

function toProviderView(sub: StubSubscription): ProviderSubscription {
  return {
    ref: sub.ref,
    planCode: sub.planCode,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd.getTime()) : null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  };
}

export class StubPaymentProvider implements PaymentProvider {
  readonly id = "stub";

  private readonly config: StubVendorConfig;
  private readonly clock: Clock;
  private subscriptions = new Map<string, StubSubscription>();
  private eventLog: StubLoggedEvent[] = [];
  private outbox: StubLoggedEvent[] = [];
  private counters = { subscription: 0, event: 0 };

  constructor(config: StubVendorConfig = DEFAULT_CONFIG, clock: Clock = systemClock) {
    this.config = config;
    this.clock = clock;
  }

  // -- PaymentProvider port -------------------------------------------------

  async createCheckout(input: {
    householdId: string;
    planCode: string;
    idempotencyKey: string;
  }): Promise<{ redirectUrl?: string; clientToken?: string; reference: string }> {
    const now = this.clock.now();
    this.counters.subscription += 1;
    const ref = `stub_sub_${this.counters.subscription}`;
    const trialEndsAt = addDays(now, STUB_TRIAL_DAYS);
    this.subscriptions.set(ref, {
      ref,
      householdId: input.householdId,
      planCode: input.planCode,
      status: "trialing",
      trialEndsAt,
      currentPeriodEnd: trialEndsAt,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      failures: 0,
    });
    this.record({
      type: "subscription.activated",
      ref,
      planCode: input.planCode,
      periodEnd: trialEndsAt,
    });
    return { reference: ref };
  }

  async cancelSubscription(input: { subscriptionRef: string }): Promise<void> {
    const sub = this.require(input.subscriptionRef);
    const now = this.clock.now();
    // Immediate cancellation keeps access until the paid period ends
    // (epic #255: `cancelled` stays entitled until period end).
    const effectiveAt = sub.currentPeriodEnd ?? now;
    sub.status = "cancelled";
    sub.cancelAtPeriodEnd = true;
    this.record({ type: "subscription.cancelled", ref: sub.ref, effectiveAt });
  }

  async getSubscription(input: { subscriptionRef: string }): Promise<ProviderSubscription> {
    return toProviderView(this.require(input.subscriptionRef));
  }

  async parseWebhook(req: Request): Promise<BillingEvent[]> {
    // Signature first, exactly like every real adapter must: an unverifiable
    // request throws rather than returning "no events".
    if (req.headers.get(this.config.signatureHeader) !== this.config.validSignature) {
      throw new InvalidWebhookSignatureError("stub webhook signature missing or invalid");
    }
    // Drain the outbox: each entry is delivered exactly once unless a test
    // re-queues it via redeliverEvent (provider redelivery simulation).
    const deliveries = this.outbox;
    this.outbox = [];
    return deliveries.map((entry) => entry.event);
  }

  // -- Test-only controls (also used by the dev debug surface) --------------
  //
  // Async/sync split: the port methods plus the lifecycle transitions
  // (simulate*/reactivate) are async and reject on misuse, so tests use one
  // `await expect(...).rejects` idiom. Pure local accessors and jumps
  // (advanceTo, redeliverEvent, injectEvents, advanceTime, reset, list*,
  // getEventLog, getOutboxSize) are sync and throw directly.

  /** List every subscription in creation order (port-view copies). */
  listSubscriptions(): ProviderSubscription[] {
    return [...this.subscriptions.values()].map(toProviderView);
  }

  /** Full provider-side event history with stub event ids, oldest first. */
  getEventLog(): readonly StubLoggedEvent[] {
    return this.eventLog;
  }

  /** Number of entries waiting for the next parseWebhook delivery. */
  getOutboxSize(): number {
    return this.outbox.length;
  }

  /** Current time per the injected clock (debug/status reads). */
  now(): Date {
    return this.clock.now();
  }

  /** Jump a subscription to any status. Pure state jump — emits no events. */
  advanceTo(subscriptionRef: string, status: StubStatus): ProviderSubscription {
    const sub = this.require(subscriptionRef);
    sub.status = status;
    if (status === "expired") {
      sub.currentPeriodEnd = null;
    }
    if (status === "cancelled") {
      sub.cancelAtPeriodEnd = true;
    }
    if (status === "active" || status === "trialing") {
      sub.cancelAtPeriodEnd = false;
      sub.failures = 0;
    }
    return toProviderView(sub);
  }

  /** Successful renewal: any non-cancelled status becomes active +30 days. */
  async simulateSuccessfulRenewal(
    subscriptionRef: string,
    options: StubRenewalOptions = {},
  ): Promise<ProviderSubscription> {
    const sub = this.require(subscriptionRef);
    if (sub.status === "cancelled") {
      throw new Error(`stub ${sub.ref} is cancelled: renewals are rejected, reactivate() first`);
    }
    const now = this.clock.now();
    const periodEnd = addDays(now, STUB_RENEWAL_DAYS);
    sub.status = "active";
    sub.currentPeriodEnd = periodEnd;
    sub.graceEndsAt = null;
    sub.cancelAtPeriodEnd = false;
    sub.failures = 0;
    this.record({
      type: "payment.succeeded",
      ref: sub.ref,
      amount: createMoney(
        options.amountMinor ?? STUB_DEFAULT_AMOUNT_MINOR,
        options.currency ?? STUB_DEFAULT_CURRENCY,
      ),
      periodEnd,
    });
    return toProviderView(sub);
  }

  /**
   * Failed renewal: active/trialing → past_due (attempt 1),
   * past_due → grace (attempt 2), grace → expired (+ subscription.expired).
   * Each failure sets a 7-day grace window off the injected clock.
   */
  async simulateFailedRenewal(subscriptionRef: string): Promise<ProviderSubscription> {
    const sub = this.require(subscriptionRef);
    if (sub.status === "cancelled" || sub.status === "expired") {
      throw new Error(
        `stub ${sub.ref} is ${sub.status}: failed renewals only apply to live retries`,
      );
    }
    const now = this.clock.now();
    sub.failures += 1;
    sub.graceEndsAt = addDays(now, STUB_GRACE_DAYS);
    if (sub.status === "grace" || sub.failures >= 3) {
      sub.status = "expired";
      sub.currentPeriodEnd = null;
      this.record({ type: "subscription.expired", ref: sub.ref });
    } else if (sub.status === "past_due") {
      sub.status = "grace";
      this.record({ type: "payment.failed", ref: sub.ref, attempt: sub.failures });
    } else {
      sub.status = "past_due";
      this.record({ type: "payment.failed", ref: sub.ref, attempt: sub.failures });
    }
    return toProviderView(sub);
  }

  /** Reactivate a cancelled or expired subscription (emits activated). */
  async reactivate(subscriptionRef: string): Promise<ProviderSubscription> {
    const sub = this.require(subscriptionRef);
    if (sub.status !== "cancelled" && sub.status !== "expired") {
      throw new Error(`stub ${sub.ref} is ${sub.status}: only cancelled/expired can reactivate`);
    }
    const periodEnd = addDays(this.clock.now(), STUB_RENEWAL_DAYS);
    sub.status = "active";
    sub.currentPeriodEnd = periodEnd;
    sub.graceEndsAt = null;
    sub.cancelAtPeriodEnd = false;
    sub.failures = 0;
    this.record({
      type: "subscription.activated",
      ref: sub.ref,
      planCode: sub.planCode,
      periodEnd,
    });
    return toProviderView(sub);
  }

  /**
   * Re-queue an already-logged event for delivery WITHOUT touching
   * subscription state — this is the provider-redelivery simulation.
   * Redelivering the same event N times still reflects exactly one state
   * change (the original transition); the log length does not move.
   */
  redeliverEvent(eventId: string): StubLoggedEvent {
    const entry = this.eventLog.find((logged) => logged.id === eventId);
    if (!entry) {
      throw new Error(`stub has no logged event "${eventId}" to redeliver`);
    }
    this.outbox.push(entry);
    return entry;
  }

  /**
   * Deliver events in the given arrival order, applying each to local state
   * with the cancelled/expired-terminal precedence. Returns what applied
   * vs. what was ignored as stale. Injected events are logged (they were
   * "received") but never re-queued to the outbox.
   */
  injectEvents(events: BillingEvent[]): StubInjectSummary {
    let applied = 0;
    let ignored = 0;
    for (const event of events) {
      this.counters.event += 1;
      this.eventLog.push({ id: `stub_evt_${this.counters.event}`, event });
      if (this.applyEvent(event)) {
        applied += 1;
      } else {
        ignored += 1;
      }
    }
    return { applied, ignored };
  }

  /**
   * Move a manual clock forward. Throws on the default system clock —
   * wall-clock time travel is not a thing, even for a stub.
   */
  advanceTime(ms: number): Date {
    const clock = this.clock;
    if (!(clock instanceof ManualClock)) {
      throw new Error("stub advanceTime requires a ManualClock: pass one to the constructor");
    }
    clock.advance(ms);
    return clock.now();
  }

  /** Clear subscriptions, history, and outbox (keeps the clock value). */
  reset(): void {
    this.subscriptions = new Map();
    this.eventLog = [];
    this.outbox = [];
    this.counters = { subscription: 0, event: 0 };
  }

  // -- Internals ------------------------------------------------------------

  private require(ref: string): StubSubscription {
    const sub = this.subscriptions.get(ref);
    if (!sub) {
      throw new Error(`stub has no subscription "${ref}"`);
    }
    return sub;
  }

  /** Log + queue one provider-side transition event. */
  private record(event: BillingEvent): StubLoggedEvent {
    this.counters.event += 1;
    const entry: StubLoggedEvent = { id: `stub_evt_${this.counters.event}`, event };
    this.eventLog.push(entry);
    this.outbox.push(entry);
    return entry;
  }

  /**
   * Apply one arrived event to local state. Returns false when the event is
   * stale (a payment for a cancelled/expired subscription, or any event for
   * an unknown ref) and must not move state.
   */
  private applyEvent(event: BillingEvent): boolean {
    const sub = this.subscriptions.get(event.ref);
    if (!sub) {
      return false;
    }
    switch (event.type) {
      case "subscription.activated":
        sub.status = "active";
        sub.planCode = event.planCode;
        sub.currentPeriodEnd = new Date(event.periodEnd.getTime());
        sub.graceEndsAt = null;
        sub.cancelAtPeriodEnd = false;
        sub.failures = 0;
        return true;
      case "payment.succeeded":
        // Terminal statuses win over late money: a stale success arriving
        // after cancellation/expiry must not resurrect the subscription.
        if (sub.status === "cancelled" || sub.status === "expired") {
          return false;
        }
        sub.status = "active";
        sub.currentPeriodEnd = new Date(event.periodEnd.getTime());
        sub.graceEndsAt = null;
        sub.cancelAtPeriodEnd = false;
        sub.failures = 0;
        return true;
      case "payment.failed":
        if (sub.status === "cancelled" || sub.status === "expired") {
          return false;
        }
        sub.status = "past_due";
        sub.graceEndsAt = addDays(this.clock.now(), STUB_GRACE_DAYS);
        return true;
      case "subscription.cancelled":
        sub.status = "cancelled";
        sub.currentPeriodEnd = new Date(event.effectiveAt.getTime());
        sub.cancelAtPeriodEnd = true;
        return true;
      case "subscription.expired":
        sub.status = "expired";
        sub.currentPeriodEnd = null;
        return true;
    }
  }
}
