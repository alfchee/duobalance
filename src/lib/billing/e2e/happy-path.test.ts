import { describe, expect, it } from "vitest";
import { expireDueSubscriptions } from "../lifecycle";
import { checkout, createWorld, dbStatus, deliverAll, stubClock, stubStatus } from "./harness";

const DAY_MS = 24 * 60 * 60 * 1000;

// Happy path (#266): checkout → activation → renewal → cancellation →
// post-period expiry. Every hop is asserted on BOTH sides — the provider
// (stub) and our ledger (fake persistence via the real apply path) —
// because the suite is the contract the Phase B adapter must satisfy.

describe("billing e2e happy path (#266)", () => {
  it("checkout activates a trial on both sides", async () => {
    const world = createWorld({ tag: "happy" });
    const { reference, outcomes } = await checkout(world);

    expect(reference).toMatch(/^stub_sub_/);
    expect(await stubStatus(world)).toBe("trialing");
    expect(outcomes).toEqual([{ outcome: "applied", status: "trialing" }]);
    expect(dbStatus(world)).toBe("trialing");

    const row = world.state.subs[0];
    expect(row?.plan_code).toBe("plus");
    expect(row?.provider_ref).toBe(reference);
    expect(row?.trial_ends_at).toBe("2026-10-23T00:00:00.000Z");
  });

  it("renewal moves trialing → active and extends the period", async () => {
    const world = createWorld({ tag: "happy" });
    await checkout(world);

    world.stub.advanceTime(5 * DAY_MS);
    await world.stub.simulateSuccessfulRenewal(world.reference ?? "");
    expect(await stubStatus(world)).toBe("active");

    const outcomes = await deliverAll(world);
    expect(outcomes).toEqual([{ outcome: "applied", status: "active" }]);
    expect(dbStatus(world)).toBe("active");
    expect(world.state.subs[0]?.current_period_end).toBe("2026-10-28T00:00:00.000Z");
  });

  it("cancellation holds until period end, then the sweeper expires", async () => {
    const world = createWorld({ tag: "happy" });
    await checkout(world);
    await world.stub.simulateSuccessfulRenewal(world.reference ?? "");
    await deliverAll(world);

    await world.stub.cancelSubscription({ subscriptionRef: world.reference ?? "" });
    const cancelled = await deliverAll(world);
    expect(cancelled).toEqual([{ outcome: "applied", status: "cancelled" }]);
    expect(dbStatus(world)).toBe("cancelled");
    expect(world.state.subs[0]?.cancel_at_period_end).toBe(true);

    // The provider models cancel-at-period-end (it stays "cancelled"); OUR
    // sweeper owns the expiry flip once the period lapses.
    world.stub.advanceTime(31 * DAY_MS);
    const swept = await expireDueSubscriptions(world.db, stubClock(world.stub));
    expect(swept.expired).toHaveLength(1);
    expect(dbStatus(world)).toBe("expired");
    expect(world.state.subs[0]?.current_period_end).toBeNull();
    expect(await stubStatus(world)).toBe("cancelled");

    expect(world.stub.getOutboxSize()).toBe(0);
    expect(world.state.events).toHaveLength(3);
  });
});
