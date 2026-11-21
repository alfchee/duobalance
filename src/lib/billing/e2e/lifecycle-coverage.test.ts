import { describe, expect, it } from "vitest";
import { checkout, createWorld, dbStatus, deliverAll, stubStatus } from "./harness";

// Lifecycle coverage (#266): every state in the epic's diagram is reached
// by at least one test. This walk visits all six through real stub
// operations (no advanceTo jumps) and proves the ledger observes each hop.

describe("billing e2e lifecycle coverage (#266)", () => {
  it("reaches trialing, active, past_due, grace, expired and cancelled", async () => {
    const world = createWorld({ tag: "cov" });
    const seen = new Set<string>();
    const note = async () => {
      seen.add(await stubStatus(world));
    };

    const started = await checkout(world);
    expect(started.outcomes).toEqual([{ outcome: "applied", status: "trialing" }]);
    await note();
    await world.stub.simulateSuccessfulRenewal(world.reference ?? "");
    await note();
    await world.stub.simulateFailedRenewal(world.reference ?? "");
    await note();
    await world.stub.simulateFailedRenewal(world.reference ?? "");
    await note();
    await world.stub.simulateFailedRenewal(world.reference ?? "");
    await note();
    await world.stub.reactivate(world.reference ?? "");
    await note();
    await world.stub.cancelSubscription({ subscriptionRef: world.reference ?? "" });
    await note();

    expect([...seen].sort()).toEqual([
      "active",
      "cancelled",
      "expired",
      "grace",
      "past_due",
      "trialing",
    ]);

    const outcomes = await deliverAll(world);
    // The activation went out with checkout(); the rest replays in order.
    expect(outcomes.map((o) => (o.outcome === "applied" ? o.status : o.outcome))).toEqual([
      "active",
      "past_due",
      "grace",
      "expired",
      "active",
      "cancelled",
    ]);
    expect(dbStatus(world)).toBe("cancelled");
  });
});
