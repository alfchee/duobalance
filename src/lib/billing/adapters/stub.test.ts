import { describe, expect, it } from "vitest";
import { addDays, DAY_MS, ManualClock, SystemClock } from "../clock";
import type { BillingEvent } from "../provider";
import { STUB_GRACE_DAYS, STUB_RENEWAL_DAYS, STUB_TRIAL_DAYS, StubPaymentProvider } from "./stub";

const START = new Date("2026-09-23T00:00:00.000Z");

function signed(path = "https://example.test/api/billing/webhook"): Request {
  return new Request(path, { headers: { "x-stub-signature": "stub-valid" } });
}

function manualStub(): { stub: StubPaymentProvider; clock: ManualClock } {
  const clock = new ManualClock(START);
  return { stub: new StubPaymentProvider(undefined, clock), clock };
}

describe("StubPaymentProvider lifecycle (#259)", () => {
  it("runs trialing → active → past_due → grace → cancelled → expired → reactivated in under a second", async () => {
    const started = performance.now();
    const { stub, clock } = manualStub();

    const { reference } = await stub.createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "key_1",
    });
    expect(reference).toBe("stub_sub_1");

    let sub = await stub.getSubscription({ subscriptionRef: reference });
    expect(sub.status).toBe("trialing");
    expect(sub.currentPeriodEnd).toEqual(new Date("2026-10-23T00:00:00.000Z"));

    clock.advance(5 * DAY_MS);
    sub = await stub.simulateSuccessfulRenewal(reference);
    expect(sub.status).toBe("active");
    expect(sub.currentPeriodEnd).toEqual(new Date("2026-10-28T00:00:00.000Z"));

    clock.advance(31 * DAY_MS);
    sub = await stub.simulateFailedRenewal(reference);
    expect(sub.status).toBe("past_due");

    sub = await stub.simulateFailedRenewal(reference);
    expect(sub.status).toBe("grace");

    await stub.cancelSubscription({ subscriptionRef: reference });
    sub = await stub.getSubscription({ subscriptionRef: reference });
    expect(sub.status).toBe("cancelled");
    expect(sub.cancelAtPeriodEnd).toBe(true);

    sub = stub.advanceTo(reference, "expired");
    expect(sub.status).toBe("expired");
    expect(sub.currentPeriodEnd).toBeNull();

    sub = await stub.reactivate(reference);
    expect(sub.status).toBe("active");
    expect(sub.cancelAtPeriodEnd).toBe(false);

    const types = stub.getEventLog().map((entry) => entry.event.type);
    expect(types).toEqual([
      "subscription.activated",
      "payment.succeeded",
      "payment.failed",
      "payment.failed",
      "subscription.cancelled",
      "subscription.activated",
    ]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("computes the trial and grace windows off the injected clock", async () => {
    const { stub } = manualStub();
    const { reference } = await stub.createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "key_1",
    });
    const sub = await stub.getSubscription({ subscriptionRef: reference });
    expect(sub.currentPeriodEnd).toEqual(addDays(START, STUB_TRIAL_DAYS));

    await stub.simulateSuccessfulRenewal(reference);
    const failing = await stub.simulateFailedRenewal(reference);
    expect(failing.status).toBe("past_due");
    const events = stub.getEventLog();
    expect(events[events.length - 1]?.event.type).toBe("payment.failed");
    expect(STUB_GRACE_DAYS).toBe(7);
    expect(STUB_RENEWAL_DAYS).toBe(30);
  });
});

describe("StubPaymentProvider redelivery (#259)", () => {
  it("redelivering the same event twice produces exactly one state change", async () => {
    const { stub } = manualStub();
    const { reference } = await stub.createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "key_1",
    });
    await stub.simulateSuccessfulRenewal(reference);

    // Drain the initial deliveries; the log holds the two state changes.
    const first = await stub.parseWebhook(signed());
    expect(first).toHaveLength(2);
    expect(stub.getEventLog()).toHaveLength(2);

    const lastId = stub.getEventLog()[1]?.id ?? "";
    stub.redeliverEvent(lastId);
    stub.redeliverEvent(lastId);

    const redeliveries = await stub.parseWebhook(signed());
    expect(redeliveries).toHaveLength(2);
    expect(redeliveries[0]).toEqual(redeliveries[1]);
    // Same event, delivered twice — and still exactly one state change behind it.
    expect(stub.getEventLog()).toHaveLength(2);
    const sub = await stub.getSubscription({ subscriptionRef: reference });
    expect(sub.status).toBe("active");

    expect(() => stub.redeliverEvent("stub_evt_999")).toThrow(/no logged event/);
  });
});

describe("StubPaymentProvider out-of-order delivery (#259)", () => {
  it("a stale payment.succeeded arriving after subscription.cancelled is ignored", async () => {
    const { stub } = manualStub();
    const { reference } = await stub.createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "key_1",
    });
    const active = await stub.simulateSuccessfulRenewal(reference);
    const paidPeriodEnd = active.currentPeriodEnd ?? START;
    await stub.cancelSubscription({ subscriptionRef: reference });

    // The success for the already-paid period arrives late, after the
    // cancellation: terminal status wins over stale money.
    const staleSuccess: BillingEvent = {
      type: "payment.succeeded",
      ref: reference,
      amount: { amount: 12900, currency: "NIO" },
      periodEnd: paidPeriodEnd,
    };
    const summary = stub.injectEvents([staleSuccess]);
    expect(summary).toEqual({ applied: 0, ignored: 1 });

    const sub = await stub.getSubscription({ subscriptionRef: reference });
    expect(sub.status).toBe("cancelled");
    expect(sub.currentPeriodEnd).toEqual(paidPeriodEnd);

    // …while a genuine reactivation still applies afterwards.
    const reactivation: BillingEvent = {
      type: "subscription.activated",
      ref: reference,
      planCode: "plus",
      periodEnd: new Date("2026-12-01T00:00:00.000Z"),
    };
    expect(stub.injectEvents([reactivation])).toEqual({ applied: 1, ignored: 0 });
    expect((await stub.getSubscription({ subscriptionRef: reference })).status).toBe("active");
  });

  it("events for unknown refs are ignored, never applied", async () => {
    const { stub } = manualStub();
    const summary = stub.injectEvents([{ type: "subscription.expired", ref: "stub_sub_999" }]);
    expect(summary).toEqual({ applied: 0, ignored: 1 });
  });
});

describe("StubPaymentProvider guards (#259)", () => {
  it("rejects renewals on terminal subscriptions; only reactivate exits them", async () => {
    const { stub } = manualStub();
    const { reference } = await stub.createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "key_1",
    });
    await expect(stub.reactivate(reference)).rejects.toThrow(/only cancelled\/expired/);
    await stub.cancelSubscription({ subscriptionRef: reference });
    await expect(stub.simulateSuccessfulRenewal(reference)).rejects.toThrow(/reactivate/);
    await expect(stub.simulateFailedRenewal(reference)).rejects.toThrow(/live retries/);
    stub.advanceTo(reference, "expired");
    await expect(stub.simulateSuccessfulRenewal(reference)).rejects.toThrow(/reactivate/);
    await expect(stub.simulateFailedRenewal(reference)).rejects.toThrow(/live retries/);
  });

  it("retries the same idempotency key without duplicating state", async () => {
    const { stub } = manualStub();
    const first = await stub.createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "key_1",
    });
    const retry = await stub.createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "key_1",
    });
    expect(retry).toEqual(first);
    expect(stub.listSubscriptions()).toHaveLength(1);
    expect(stub.getEventLog()).toHaveLength(1);
    const other = await stub.createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "key_2",
    });
    expect(other.reference).not.toBe(first.reference);
  });

  it("cancel is idempotent; cancelling expired throws", async () => {
    const { stub } = manualStub();
    const { reference } = await stub.createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "key_1",
    });
    await stub.cancelSubscription({ subscriptionRef: reference });
    const logLength = stub.getEventLog().length;
    await stub.cancelSubscription({ subscriptionRef: reference });
    expect(stub.getEventLog()).toHaveLength(logLength);
    stub.advanceTo(reference, "expired");
    await expect(stub.cancelSubscription({ subscriptionRef: reference })).rejects.toThrow(
      /expired/,
    );
  });

  it("injected payment.failed retries share the simulate dunning table", async () => {
    const { stub } = manualStub();
    const { reference } = await stub.createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "key_1",
    });
    const failed = (attempt: number): BillingEvent => ({
      type: "payment.failed",
      ref: reference,
      attempt,
    });
    expect(stub.injectEvents([failed(1)])).toEqual({ applied: 1, ignored: 0 });
    expect((await stub.getSubscription({ subscriptionRef: reference })).status).toBe("past_due");
    expect(stub.injectEvents([failed(9)])).toEqual({ applied: 1, ignored: 0 });
    expect((await stub.getSubscription({ subscriptionRef: reference })).status).toBe("grace");
    expect(stub.injectEvents([failed(3)])).toEqual({ applied: 1, ignored: 0 });
    expect((await stub.getSubscription({ subscriptionRef: reference })).status).toBe("expired");
  });

  it("getEventLog returns a copy callers cannot corrupt", async () => {
    const { stub } = manualStub();
    await stub.createCheckout({ householdId: "hh_1", planCode: "plus", idempotencyKey: "k" });
    (stub.getEventLog() as unknown as unknown[]).push({ id: "forged", event: null });
    expect(stub.getEventLog()).toHaveLength(1);
  });

  it("throws on unknown subscription refs", async () => {
    const { stub } = manualStub();
    await expect(stub.getSubscription({ subscriptionRef: "nope" })).rejects.toThrow(
      /no subscription/,
    );
    await expect(stub.cancelSubscription({ subscriptionRef: "nope" })).rejects.toThrow(
      /no subscription/,
    );
    expect(() => stub.advanceTo("nope", "active")).toThrow(/no subscription/);
  });

  it("advanceTime requires a manual clock", async () => {
    const systemStub = new StubPaymentProvider(undefined, new SystemClock());
    expect(() => systemStub.advanceTime(DAY_MS)).toThrow(/ManualClock/);
    const { stub, clock } = manualStub();
    stub.advanceTime(DAY_MS);
    expect(clock.now()).toEqual(new Date("2026-09-24T00:00:00.000Z"));
  });

  it("reset clears state but keeps the clock", async () => {
    const { stub, clock } = manualStub();
    await stub.createCheckout({ householdId: "hh_1", planCode: "plus", idempotencyKey: "k" });
    clock.advance(DAY_MS);
    stub.reset();
    expect(stub.listSubscriptions()).toHaveLength(0);
    expect(stub.getEventLog()).toHaveLength(0);
    expect(stub.getOutboxSize()).toBe(0);
    expect(clock.now()).toEqual(new Date("2026-09-24T00:00:00.000Z"));
  });
});
