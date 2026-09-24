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
  private checkoutKeys = new Map<string, string>();
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
    // Idempotent checkout: retrying the same key returns the original
    // reference without minting a duplicate subscription or event — the
    // semantic #266 exercises through the port.
    const existing = this.checkoutKeys.get(input.idempotencyKey);
    if (existing) {
      return { reference: existing };
    }
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
    this.checkoutKeys.set(input.idempotencyKey, ref);
    return { reference: ref };
  }

  async cancelSubscription(input: { subscriptionRef: string }): Promise<void> {
    const sub = this.require(input.subscriptionRef);
    // Idempotent cancel: repeating it emits nothing further.
    if (sub.status === "cancelled") {
      return;
    }
    if (sub.status === "expired") {
      throw new Error(`stub ${sub.ref} is expired: cancelling it would resurrect the period end`);
    }
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
    const entries = await this.parseWebhookEntries(req);
    return entries.map((entry) => entry.event);
  }

  /**
   * Same signature check + outbox drain as parseWebhook, but retaining the
   * provider event ids. The e2e harness delivers through this so ledger
   * dedupe runs on the real `stub_evt_N` ids instead of synthetic keys.
   */
  async parseWebhookEntries(req: Request): Promise<StubLoggedEvent[]> {
    // Signature first, exactly like every real adapter must: an unverifiable
    // request throws rather than returning "no events".
    if (req.headers.get(this.config.signatureHeader) !== this.config.validSignature) {
      throw new InvalidWebhookSignatureError("stub webhook signature missing or invalid");
    }
    // Drain the outbox: each entry is delivered exactly once unless a test
    // re-queues it via redeliverEvent (provider redelivery simulation).
    const deliveries = this.outbox;
    this.outbox = [];
    return [...deliveries];
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
    // Copy: readonly is compile-time only, and the redelivery tests assert
    // on log length — callers must not be able to corrupt history.
    return [...this.eventLog];
  }

  /** Number of entries waiting for the next parseWebhook delivery. */
  getOutboxSize(): number {
    return this.outbox.length;
  }

  /** Current time per the injected clock (debug/status reads). */
  now(): Date {
    return this.clock.now();
  }

  /**
   * Jump a subscription to any status. Pure state jump — emits no events —
   * but keeps the date/counter fields consistent with the target so later
   * reads (and #260-style consumers of stub internals) see a coherent row.
   */
  advanceTo(subscriptionRef: string, status: StubStatus): ProviderSubscription {
    const sub = this.require(subscriptionRef);
    const now = this.clock.now();
    sub.status = status;
    if (status === "expired") {
      sub.currentPeriodEnd = null;
      sub.graceEndsAt = null;
    }
    if (status === "cancelled") {
      sub.cancelAtPeriodEnd = true;
    }
    if (status === "grace" && !sub.graceEndsAt) {
      sub.graceEndsAt = addDays(now, STUB_GRACE_DAYS);
    }
    if (status === "active" || status === "trialing") {
      sub.cancelAtPeriodEnd = false;
      sub.failures = 0;
      sub.graceEndsAt = null;
    }
    return toProviderView(sub);
  }

  /**
   * Successful renewal: any live (non-cancelled, non-expired) status becomes
   * active +30 days. Terminal statuses reject — reactivation goes through
   * reactivate(), matching the injected-event precedence below.
   */
  async simulateSuccessfulRenewal(
    subscriptionRef: string,
    options: StubRenewalOptions = {},
  ): Promise<ProviderSubscription> {
    const sub = this.require(subscriptionRef);
    if (sub.status === "cancelled" || sub.status === "expired") {
      throw new Error(
        `stub ${sub.ref} is ${sub.status}: renewals are rejected, reactivate() first`,
      );
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
    if (this.registerFailure(sub)) {
      this.record({ type: "subscription.expired", ref: sub.ref });
    } else {
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
    this.checkoutKeys = new Map();
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

  /**
   * Shared dunning step used by BOTH the simulate path and injected
   * provider retries: bump the failure count, refresh the 7-day grace
   * window, and walk past_due → grace → expired. Returns true when the
   * step expired the subscription (caller records subscription.expired).
   * The provider-sent attempt number is informational — the stub's own
   * counter is the ledger, so mixed simulate/inject sequences stay in sync.
   */
  private registerFailure(sub: StubSubscription): boolean {
    sub.failures += 1;
    sub.graceEndsAt = addDays(this.clock.now(), STUB_GRACE_DAYS);
    if (sub.status === "grace" || sub.failures >= 3) {
      sub.status = "expired";
      sub.currentPeriodEnd = null;
      return true;
    }
    sub.status = sub.status === "past_due" ? "grace" : "past_due";
    return false;
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
        if (this.registerFailure(sub)) {
          this.record({ type: "subscription.expired", ref: sub.ref });
        }
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
