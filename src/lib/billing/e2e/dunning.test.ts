import { describe, expect, it } from "vitest";
import { expireDueSubscriptions } from "../lifecycle";
import { checkout, createWorld, dbStatus, deliverAll, stubClock, stubStatus } from "./harness";

const DAY_MS = 24 * 60 * 60 * 1000;

// Failure path (#266): failed payment → dunning (past_due) → grace →
// sweeper expiry past the grace deadline. The 7-day grace window runs on the
// injected clock — ~11 simulated days, zero real elapsed time. (The stub's
// 3rd-failure count expiry is covered by the coverage/reactivation walks;
// here the ledger must expire through `expireDueSubscriptions`, the stated
// contract.)

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

    // Still inside the refreshed window (2026-09-26 + 6d = 2026-10-02, grace
    // ends 2026-10-03): the sweeper must not touch the grace row.
    world.stub.advanceTime(6 * DAY_MS);
    const early = await expireDueSubscriptions(world.db, stubClock(world.stub));
    expect(early.expired).toEqual([]);
    expect(dbStatus(world)).toBe("grace");

    // Past the deadline the sweeper expires the ledger row and clears the
    // period. The stub holds no time-based transition (it stays grace until
    // a 3rd failure), so provider/ledger diverge here by design — same shape
    // as the cancelled-then-swept happy path.
    world.stub.advanceTime(2 * DAY_MS);
    const swept = await expireDueSubscriptions(world.db, stubClock(world.stub));
    expect(swept.expired).toHaveLength(1);
    expect(dbStatus(world)).toBe("expired");
    expect(world.state.subs[0]?.current_period_end).toBeNull();
    expect(await stubStatus(world)).toBe("grace");

    // The ledger saw attempt 1 then 2 — dunning pressure is observable.
    const attempts = world.stub
      .getEventLog()
      .map((entry) => entry.event)
      .filter((event) => event.type === "payment.failed")
      .map((event) => (event.type === "payment.failed" ? event.attempt : -1));
    expect(attempts).toEqual([1, 2]);
  });
});
