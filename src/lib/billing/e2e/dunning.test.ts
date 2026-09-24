import { describe, expect, it } from "vitest";
import { checkout, createWorld, dbStatus, deliverAll, stubStatus } from "./harness";

const DAY_MS = 24 * 60 * 60 * 1000;

// Failure path (#266): failed payment → dunning (past_due) → grace →
// expiry. The 30-day trial and 7-day grace windows run on the injected
// clock — 38 simulated days, zero real elapsed time.

describe("billing e2e dunning (#266)", () => {
  it("walks active → past_due → grace → expired with attempt counting", async () => {
    const world = createWorld({ tag: "dun" });
    await checkout(world);
    await world.stub.simulateSuccessfulRenewal(world.reference ?? "");
    await deliverAll(world);
    expect(dbStatus(world)).toBe("active");

    // First failed renewal: past_due with a 7-day grace window off the clock.
    await world.stub.simulateFailedRenewal(world.reference ?? "");
    expect(await stubStatus(world)).toBe("past_due");
    const first = await deliverAll(world);
    expect(first).toEqual([{ outcome: "applied", status: "past_due" }]);
    expect(dbStatus(world)).toBe("past_due");
    expect(world.state.subs[0]?.grace_ends_at).toBe("2026-09-30T00:00:00.000Z");

    // Second failure inside the window: grace, with the 7-day window
    // refreshed off the clock (3 days in → grace ends 10 days after start).
    world.stub.advanceTime(3 * DAY_MS);
    await world.stub.simulateFailedRenewal(world.reference ?? "");
    expect(await stubStatus(world)).toBe("grace");
    const second = await deliverAll(world);
    expect(second).toEqual([{ outcome: "applied", status: "grace" }]);
    expect(dbStatus(world)).toBe("grace");
    expect(world.state.subs[0]?.grace_ends_at).toBe("2026-10-03T00:00:00.000Z");

    // Third failure: expired by failure count (stub expires on the 3rd
    // failure, not on the grace timestamp), period cleared.
    world.stub.advanceTime(8 * DAY_MS);
    await world.stub.simulateFailedRenewal(world.reference ?? "");
    expect(await stubStatus(world)).toBe("expired");
    const third = await deliverAll(world);
    expect(third).toEqual([{ outcome: "applied", status: "expired" }]);
    expect(dbStatus(world)).toBe("expired");
    expect(world.state.subs[0]?.current_period_end).toBeNull();

    // The ledger saw attempt 1 then 2 — dunning pressure is observable.
    const attempts = world.stub
      .getEventLog()
      .map((entry) => entry.event)
      .filter((event) => event.type === "payment.failed")
      .map((event) => (event.type === "payment.failed" ? event.attempt : -1));
    expect(attempts).toEqual([1, 2]);
  });
});
