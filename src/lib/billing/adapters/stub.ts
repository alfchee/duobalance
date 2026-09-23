import type { BillingEvent, PaymentProvider, ProviderSubscription } from "../provider";
import { InvalidWebhookSignatureError } from "../provider";

// StubPaymentProvider — placeholder backing the "stub" id until #259 fleshes
// out the full lifecycle (injectable clock, local state, on-demand events).
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

const NOT_IMPLEMENTED = "StubPaymentProvider: full lifecycle lands in #259";

export class StubPaymentProvider implements PaymentProvider {
  readonly id = "stub";

  private readonly config: StubVendorConfig;

  constructor(config: StubVendorConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  // Async with full input signatures: the port is promise-based, so these
  // must return rejected promises (never throw synchronously), and the
  // inputs stay visible to keep the idempotency-key contract explicit.
  async createCheckout(_input: {
    householdId: string;
    planCode: string;
    idempotencyKey: string;
  }): Promise<{ redirectUrl?: string; clientToken?: string; reference: string }> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async cancelSubscription(_input: { subscriptionRef: string }): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getSubscription(_input: { subscriptionRef: string }): Promise<ProviderSubscription> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async parseWebhook(req: Request): Promise<BillingEvent[]> {
    // Signature first, exactly like every real adapter must: an unverifiable
    // request throws rather than returning "no events".
    if (req.headers.get(this.config.signatureHeader) !== this.config.validSignature) {
      throw new InvalidWebhookSignatureError("stub webhook signature missing or invalid");
    }
    // Valid signature, nothing queued in this placeholder (#259 drives events).
    return [];
  }
}
