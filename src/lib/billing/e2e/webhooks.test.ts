import { describe, expect, it } from "vitest";
import { createMoney } from "../money";
import { InvalidWebhookSignatureError, type BillingEvent } from "../provider";
import { checkout, createWorld, dbStatus, deliverAll, deliverOne } from "./harness";

// Webhook realities (#266): every real provider redelivers and reorders.
// Duplicates must collapse to one state change; stale and unknown events
// must never move the ledger. Asserted explicitly, not assumed.

describe("billing e2e webhook delivery (#266)", () => {
  it("collapses a duplicate delivery into exactly one state change", async () => {
    const world = createWorld({ tag: "dup" });
    await checkout(world);
    const updatesAfterFirst = world.state.updates.length;

    // Provider redelivers the activation through the real path: the
    // redelivered entry carries the SAME stub_evt_N id, so the ledger
    // dedupes on (provider, event id) and the outbox drains fully.
    const entry = world.stub.getEventLog()[0];
    if (!entry) throw new Error("e2e expected a logged activation");
    world.stub.redeliverEvent(entry.id);
    const outcomes = await deliverAll(world);

    expect(outcomes).toEqual([{ outcome: "duplicate" }]);
    expect(dbStatus(world)).toBe("trialing");
    expect(world.state.updates.length).toBe(updatesAfterFirst);
    expect(world.stub.getOutboxSize()).toBe(0);
  });

  it("ignores a stale payment arriving after cancellation", async () => {
    const world = createWorld({ tag: "ooo" });
    await checkout(world);
    await world.stub.simulateSuccessfulRenewal(world.reference ?? "");
    await deliverAll(world);
    await world.stub.cancelSubscription({ subscriptionRef: world.reference ?? "" });
    await deliverAll(world);
    expect(dbStatus(world)).toBe("cancelled");
    const updatesBefore = world.state.updates.length;

    // Out-of-order arrival: a renewal that crossed the cancellation.
    const stale: BillingEvent = {
      type: "payment.succeeded",
      ref: world.reference ?? "",
      amount: createMoney(12900, "NIO"),
      periodEnd: new Date("2026-11-23T00:00:00.000Z"),
    };
    const outcome = await deliverOne(world, stale, `e2e_${world.tag}_stale`);
    expect(outcome.outcome).toBe("ignored");
    expect(dbStatus(world)).toBe("cancelled");
    expect(world.state.updates.length).toBe(updatesBefore);
  });

  it("rejects events for unknown refs instead of creating rows", async () => {
    const world = createWorld({ tag: "ooo" });
    const phantom: BillingEvent = {
      type: "payment.failed",
      ref: "stub_sub_nope",
      attempt: 1,
    };
    const outcome = await deliverOne(world, phantom, `e2e_${world.tag}_phantom`);
    expect(outcome.outcome).toBe("rejected");
    expect(world.state.subs).toHaveLength(0);
  });

  it("refuses unverifiable deliveries at the port, before any state", async () => {
    const world = createWorld({ tag: "ooo" });
    await expect(
      world.stub.parseWebhook(
        new Request("http://localhost/api/billing/webhook", { method: "POST" }),
      ),
    ).rejects.toThrowError(InvalidWebhookSignatureError);
    expect(world.state.subs).toHaveLength(0);
    expect(world.state.events).toHaveLength(0);
  });
});
