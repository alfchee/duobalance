import { afterEach, describe, expect, it } from "vitest";
import { InvalidWebhookSignatureError, type PaymentProvider } from "./provider";
import {
  DEFAULT_PROVIDER_ID,
  getActiveProvider,
  getProvider,
  registerProvider,
  resetBillingRegistry,
  resolveProviderId,
  UnknownProviderError,
} from "./registry";

function fakeProvider(id: string): PaymentProvider {
  return {
    id,
    createCheckout: () => Promise.resolve({ reference: `${id}-ref` }),
    cancelSubscription: () => Promise.resolve(),
    getSubscription: () =>
      Promise.resolve({
        ref: `${id}-ref`,
        planCode: "plus",
        status: "active",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      }),
    parseWebhook: () => Promise.resolve([]),
  };
}

afterEach(() => {
  resetBillingRegistry();
  delete process.env.BILLING_PROVIDER;
});

describe("provider registry (#258)", () => {
  it("resolves the stub by default", () => {
    delete process.env.BILLING_PROVIDER;
    expect(DEFAULT_PROVIDER_ID).toBe("stub");
    expect(resolveProviderId()).toBe("stub");
    expect(getActiveProvider().id).toBe("stub");
  });

  it("treats a blank BILLING_PROVIDER as unset", () => {
    process.env.BILLING_PROVIDER = "  ";
    expect(resolveProviderId()).toBe("stub");
    expect(getActiveProvider().id).toBe("stub");
  });

  it("resolves the provider named by BILLING_PROVIDER", () => {
    registerProvider(fakeProvider("acme-pay"));
    process.env.BILLING_PROVIDER = "acme-pay";
    expect(getActiveProvider().id).toBe("acme-pay");
    expect(getProvider("stub").id).toBe("stub");
  });

  it("throws UnknownProviderError on an unregistered id", () => {
    expect(() => getProvider("stripe")).toThrow(UnknownProviderError);
    expect(() => getProvider("stripe")).toThrow(/unknown billing provider "stripe"/);
  });

  it("throws on duplicate registration instead of silently overwriting", () => {
    expect(() => registerProvider(fakeProvider("stub"))).toThrow(/already registered/);
  });

  it("stub lifecycle methods reject (never throw synchronously)", async () => {
    const provider = getActiveProvider();
    await expect(
      provider.createCheckout({ householdId: "h_1", planCode: "plus", idempotencyKey: "k_1" }),
    ).rejects.toThrow(/#259/);
    await expect(provider.cancelSubscription({ subscriptionRef: "sub_1" })).rejects.toThrow(/#259/);
    await expect(provider.getSubscription({ subscriptionRef: "sub_1" })).rejects.toThrow(/#259/);
  });

  it("parseWebhook throws on a bad signature instead of returning []", async () => {
    const provider = getActiveProvider();
    await expect(
      provider.parseWebhook(new Request("https://example.test/api/billing/webhook")),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it("parseWebhook accepts a valid stub signature", async () => {
    const provider = getActiveProvider();
    const req = new Request("https://example.test/api/billing/webhook", {
      headers: { "x-stub-signature": "stub-valid" },
    });
    await expect(provider.parseWebhook(req)).resolves.toEqual([]);
  });
});
