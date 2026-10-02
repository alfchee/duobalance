import { describe, expect, it } from "vitest";
import { checkout, createWorld, dbStatus, deliverAll, stubStatus } from "./harness";

// Reactivation (#266): expired and cancelled both exit through a fresh
// activation. The ledger walk is asserted event-by-event: the whole
// failure arc replays through applyBillingEvent before recovery lands.

describe("billing e2e reactivation (#266)", () => {
  it("reactivates an expired subscription back to active", async () => {
    const world = createWorld({ tag: "re" });
    const started = await checkout(world);
    expect(started.outcomes).toEqual([{ outcome: "applied", status: "trialing" }]);
    await world.stub.simulateFailedRenewal(world.reference ?? "");
    await world.stub.simulateFailedRenewal(world.reference ?? "");
    await world.stub.simulateFailedRenewal(world.reference ?? "");
    expect(await stubStatus(world)).toBe("expired");

    await world.stub.reactivate(world.reference ?? "");
    expect(await stubStatus(world)).toBe("active");

    const outcomes = await deliverAll(world);
    // checkout() already delivered the activation; the remaining outbox
    // replays the failure arc before recovery lands.
    expect(outcomes.map((o) => (o.outcome === "applied" ? o.status : o.outcome))).toEqual([
      "past_due",
      "grace",
      "expired",
      "active",
    ]);
    expect(dbStatus(world)).toBe("active");
    expect(world.state.subs[0]?.plan_code).toBe("plus");
  });

  it("reactivates a cancelled subscription back to active", async () => {
    const world = createWorld({ tag: "re" });
    await checkout(world);
    await world.stub.simulateSuccessfulRenewal(world.reference ?? "");
    await deliverAll(world);
    await world.stub.cancelSubscription({ subscriptionRef: world.reference ?? "" });
    await deliverAll(world);
    expect(dbStatus(world)).toBe("cancelled");

    await world.stub.reactivate(world.reference ?? "");
    const outcomes = await deliverAll(world);
    expect(outcomes).toEqual([{ outcome: "applied", status: "active" }]);
    expect(dbStatus(world)).toBe("active");
    expect(world.state.subs[0]?.cancel_at_period_end).toBe(false);
  });
});
