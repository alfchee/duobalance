import type { Money } from "./money";

// PaymentProvider port and BillingEvent vocabulary (issue #258, ADR 0002).
//
// This module is the boundary that makes the rest of the billing epic
// possible. Entitlements, dunning and grace logic program against these
// types only: no vendor type may cross into the domain, so switching
// provider later is one adapter rather than a rewrite.
//
// IMPORT RULE: nothing outside `src/lib/billing/adapters/` may define or
// import a provider-specific type. The sole exemption is
// `src/lib/billing/registry.ts` (the composition root, which wires adapters
// to the port). Enforced by the `billing/adapters` boundary in
// `eslint.config.mjs` and locked by `boundary.test.ts`.
//
// The three declarations below are the issue's vocabulary, verbatim.

export interface ProviderSubscription {
  ref: string;
  planCode: string;
  status: "trialing" | "active" | "past_due" | "grace" | "cancelled" | "expired";
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export type BillingEvent =
  | { type: "subscription.activated"; ref: string; planCode: string; periodEnd: Date }
  | { type: "payment.succeeded"; ref: string; amount: Money; periodEnd: Date }
  | { type: "payment.failed"; ref: string; attempt: number }
  | { type: "subscription.cancelled"; ref: string; effectiveAt: Date }
  | { type: "subscription.expired"; ref: string };

/**
 * Thrown by `PaymentProvider.parseWebhook` when the request signature is
 * missing or invalid. Adapters own signature verification and MUST throw
 * this — never return an empty array, which the caller would misread as
 * "no events" and silently drop a (possibly forged) delivery.
 */
export class InvalidWebhookSignatureError extends Error {
  constructor(message = "invalid webhook signature") {
    super(message);
    this.name = "InvalidWebhookSignatureError";
  }
}

/**
 * One verified provider delivery: the translated domain event plus the
 * provider's own event id. The id is the dedupe key for
 * `billing_events(provider, provider_event_id)` (#267) — two deliveries
 * carrying the same id collapse to one state change, and redelivery after
 * a crash adopts the stranded RECEIVED row instead of double-applying.
 */
export interface WebhookDelivery {
  /** Provider-native event id (e.g. the stub's `stub_evt_N`). */
  readonly id: string;
  readonly event: BillingEvent;
}

export interface PaymentProvider {
  readonly id: string;
  createCheckout(input: {
    householdId: string;
    planCode: string;
    idempotencyKey: string;
  }): Promise<{ redirectUrl?: string; clientToken?: string; reference: string }>;
  cancelSubscription(input: { subscriptionRef: string }): Promise<void>;
  getSubscription(input: { subscriptionRef: string }): Promise<ProviderSubscription>;
  /**
   * Verify the request signature, then translate the payload into our
   * BillingEvent vocabulary. Assumes redelivery and out-of-order arrival;
   * dedupe on the provider's event id happens downstream (#267).
   *
   * @throws {InvalidWebhookSignatureError} When the signature is missing or
   * invalid. Never return `[]` for an unverifiable request.
   */
  parseWebhook(req: Request): Promise<BillingEvent[]>;
  /**
   * Same verification as `parseWebhook`, but retaining each delivery's
   * provider-native event id. The webhook route (#267) prefers this when
   * the active provider offers it and falls back to `parseWebhook` with a
   * deterministic synthetic id otherwise, so dedupe never depends on which
   * port method an adapter implemented.
   *
   * @throws {InvalidWebhookSignatureError} When the signature is missing or
   * invalid. Never return `[]` for an unverifiable request.
   */
  parseWebhookDeliveries?(req: Request): Promise<WebhookDelivery[]>;
}
