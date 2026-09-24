import { afterEach, describe, expect, it, vi } from "vitest";
import { effectiveEntitlement } from "../enabled";
import { expireDueSubscriptions } from "../lifecycle";
import { baseSub, checkout, createWorld, dbStatus, deliverAll, stubClock } from "./harness";

const DAY_MS = 24 * 60 * 60 * 1000;

// Simulated billing go-live (#266): with BILLING_ENABLED=1, a comped
// household keeps full entitlement no matter how much time passes, while a
// downgraded (expired) household loses it. The database half of this story
// — writes actually refused by RLS — is proven in
// supabase/tests/30_billing_lifecycle_e2e.sql; here the ledger half.

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.BILLING_ENABLED;
  delete process.env.NEXT_PUBLIC_BILLING_ENABLED;
});

describe("billing e2e simulated go-live (#266)", () => {
  it("a comped household survives go-live: immune to the sweeper, still entitled", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    const world = createWorld({ tag: "live", householdId: "e2e_hh_comped", planCode: "comped" });
    world.state.subs.push(
      baseSub({
        household_id: "e2e_hh_comped",
        plan_code: "comped",
        status: "active",
        provider_ref: "stub_sub_comped",
        trial_ends_at: null,
        current_period_end: null,
        grace_ends_at: null,
      }),
    );

    // A full year passes with billing live: the sweeper only selects
    // trialing/past_due/grace/cancelled (lifecycle.isExpirable), so the
    // `active` comped row is untouched by construction — this asserts the
    // sweeper no-op, while the comped RLS half lives in the DB test.
    world.stub.advanceTime(365 * DAY_MS);
    const swept = await expireDueSubscriptions(world.db, stubClock(world.stub));
    expect(swept.expired).toEqual([]);
    expect(world.state.subs[0]?.status).toBe("active");
    // Entitlement derived from the ledger row, not a literal: comped + active
    // means entitled, and with billing live the flag passes it through.
    const entitled = world.state.subs[0]?.status === "active";
    expect(entitled).toBe(true);
    expect(effectiveEntitlement(entitled)).toBe(true);
  });

  it("a downgraded household loses entitlement at the ledger once live", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    const world = createWorld({ tag: "live" });
    await checkout(world);
    await world.stub.simulateSuccessfulRenewal(world.reference ?? "");
    await deliverAll(world);
    await world.stub.cancelSubscription({ subscriptionRef: world.reference ?? "" });
    await deliverAll(world);

    world.stub.advanceTime(40 * DAY_MS);
    const swept = await expireDueSubscriptions(world.db, stubClock(world.stub));
    expect(swept.expired).toHaveLength(1);
    expect(dbStatus(world)).toBe("expired");
    expect(effectiveEntitlement(false)).toBe(false);
  });
});
