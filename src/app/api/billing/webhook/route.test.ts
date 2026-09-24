import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillingEvent, PaymentProvider } from "@/lib/billing/provider";
import { getActiveProvider, registerProvider, resetBillingRegistry } from "@/lib/billing/registry";
import type { Database } from "@/lib/supabase/types";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceRoleClient: vi.fn() }));
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Structural view over the registry stub's test controls. Declared locally
// so this file never imports from billing/adapters (boundary, #258).
interface TestStub extends PaymentProvider {
  createCheckout(input: {
    householdId: string;
    planCode: string;
    idempotencyKey: string;
  }): Promise<{ reference: string }>;
  simulateSuccessfulRenewal(subscriptionRef: string): Promise<unknown>;
  parseWebhookDeliveries(req: Request): Promise<Array<{ id: string; event: BillingEvent }>>;
  redeliverEvent(eventId: string): { id: string };
}

function stub(): TestStub {
  return getActiveProvider() as unknown as TestStub;
}

function post(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ type: "ping" }),
  });
}

const SIGNED = { "x-stub-signature": "stub-valid" };

function signed(): Request {
  return post(SIGNED);
}

type FakeSub = {
  id: string;
  household_id: string;
  plan_code: string;
  provider: string;
  provider_ref: string | null;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
  cancel_at_period_end: boolean;
};

type FakeEvent = {
  provider: string;
  provider_event_id: string;
  subscription_id: string | null;
  type: string | null;
  payload: unknown;
  processed_at: string | null;
};

interface FakeState {
  subs: FakeSub[];
  events: FakeEvent[];
  updates: unknown[];
  /** When true, the billing_events processed-mark throws (retry test). */
  failEventsUpdate?: boolean;
}

// Postgrest-chain emulator with the billing_events 23505 dedupe contract,
// mirroring lifecycle-io.test.ts. Drives the REAL applyBillingEvent through
// the route so dedupe is proven, not mocked.
function makeDb(state: FakeState) {
  type Filter = { col: string; value: unknown };
  const match = (row: Record<string, unknown>, filters: Filter[]) =>
    filters.every((f) => row[f.col] === f.value);
  const chainable = <T>(apply: (filters: Filter[]) => T) => {
    const filters: Filter[] = [];
    const chain: Record<string, unknown> = {};
    chain.eq = (col: string, value: unknown) => {
      filters.push({ col, value });
      return chain;
    };
    chain.then = (resolve: (v: unknown) => void) => resolve(apply(filters));
    chain.maybeSingle = async () => apply(filters);
    chain.single = async () => apply(filters);
    return chain;
  };
  const from = (table: string) => {
    if (table === "billing_events") {
      return {
        insert: async (input: { provider: string; provider_event_id: string }) => {
          const key = `${input.provider}|${input.provider_event_id}`;
          if (state.events.some((e) => `${e.provider}|${e.provider_event_id}` === key)) {
            return { error: { code: "23505", message: "duplicate key" } };
          }
          state.events.push({
            provider: input.provider,
            provider_event_id: input.provider_event_id,
            subscription_id: null,
            type: null,
            payload: null,
            processed_at: null,
          });
          return { error: null };
        },
        select: (_cols: string) =>
          chainable((filters) => ({
            data:
              (state.events.find((e) =>
                match(e as unknown as Record<string, unknown>, filters),
              ) as FakeEvent) ?? null,
            error: null,
          })),
        update: (values: Record<string, unknown>) => {
          const filters: Filter[] = [];
          const chain: Record<string, unknown> = {};
          chain.eq = (col: string, value: unknown) => {
            filters.push({ col, value });
            return chain;
          };
          chain.then = (resolve: (v: unknown) => void) => {
            // markProcessed treats any truthy error as fatal and propagates,
            // so the route answers 500 with processed_at still null.
            if (state.failEventsUpdate) {
              resolve({ error: { code: "XX000", message: "connection reset" } });
              return;
            }
            for (const m of state.events.filter((e) =>
              match(e as unknown as Record<string, unknown>, filters),
            )) {
              Object.assign(m, values);
            }
            resolve({ error: null });
          };
          chain.select = (_cols: string) => chain;
          return chain;
        },
      };
    }
    if (table === "plans") {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, value: string) => ({
            maybeSingle: async () => ({
              data: ["free", "plus", "comped"].includes(value) ? { code: value } : null,
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "subscriptions") {
      return {
        select: (_cols: string) => {
          const filters: Filter[] = [];
          const chain: Record<string, unknown> = {};
          chain.eq = (col: string, value: unknown) => {
            filters.push({ col, value });
            return chain;
          };
          chain.maybeSingle = async () => ({
            data:
              (state.subs.find((r) =>
                match(r as unknown as Record<string, unknown>, filters),
              ) as FakeSub) ?? null,
            error: null,
          });
          chain.then = (resolve: (v: unknown) => void) =>
            resolve({
              data: state.subs.filter((r) =>
                match(r as unknown as Record<string, unknown>, filters),
              ),
              error: null,
            });
          return chain;
        },
        insert: (input: Record<string, unknown>) => ({
          select: (_cols: string) => ({
            single: async () => {
              const created = { id: `sub_${state.subs.length + 1}`, ...input } as FakeSub;
              state.subs.push(created);
              return { data: { id: created.id }, error: null };
            },
          }),
        }),
        update: (values: Record<string, unknown>) => {
          const filters: Filter[] = [];
          const chain: Record<string, unknown> = {};
          chain.eq = (col: string, value: unknown) => {
            filters.push({ col, value });
            return chain;
          };
          chain.select = (_cols: string) => ({
            then: (resolve: (v: unknown) => void) => {
              const matched = state.subs.filter((r) =>
                match(r as unknown as Record<string, unknown>, filters),
              );
              for (const m of matched) {
                Object.assign(m, values);
                state.updates.push({ id: m.id, values });
              }
              resolve({ data: matched.map((m) => ({ id: m.id })), error: null });
            },
          });
          return chain;
        },
      };
    }
    if (table === "dunning_deliveries") {
      return {
        delete: () => ({
          eq: async () => ({ error: null }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  };
  return { from } as unknown as SupabaseClient<Database>;
}

function trialingSub(overrides: Partial<FakeSub> = {}): FakeSub {
  return {
    id: "sub_1",
    household_id: "hh_1",
    plan_code: "plus",
    provider: "stub",
    provider_ref: "stub_sub_1",
    status: "trialing",
    trial_ends_at: "2026-10-23T00:00:00.000Z",
    current_period_end: "2026-11-23T00:00:00.000Z",
    grace_ends_at: null,
    cancel_at_period_end: false,
    ...overrides,
  };
}

function mockDb(state: FakeState) {
  vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(makeDb(state));
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.BILLING_ENABLED;
  delete process.env.NEXT_PUBLIC_BILLING_ENABLED;
  delete process.env.BILLING_PROVIDER;
  resetBillingRegistry();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("/api/billing/webhook (#262)", () => {
  it("returns 404 — not 500 — when the flag is off", async () => {
    const res = await POST(post());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("returns 404 when the flag is explicitly off", async () => {
    vi.stubEnv("BILLING_ENABLED", "0");
    const res = await POST(post());
    expect(res.status).toBe(404);
  });

  it("returns 404 even with a forged signature header while the flag is off", async () => {
    const res = await POST(post({ "x-stub-signature": "anything" }));
    expect(res.status).toBe(404);
  });

  it("verifies the signature once the flag is on: bad signature is 401, not 404", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    const res = await POST(post({ "x-stub-signature": "wrong" }));
    expect(res.status).toBe(401);
  });
});

describe("/api/billing/webhook dedupe and idempotency (#267)", () => {
  it("rejects an invalid signature without any state change", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    const res = await POST(post({ "x-stub-signature": "wrong" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid webhook signature" });
    // Verification precedes every write: the service client is never built.
    expect(createSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("persists a redelivered event once, applies it once, returns 200 twice", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    const state: FakeState = { subs: [trialingSub()], events: [], updates: [] };
    mockDb(state);

    // Checkout queues the activation; drain it directly (it was "already
    // delivered" — the ledger row it would have created is the pre-seeded
    // trialing row above). The renewal is the delivery under test.
    const { reference } = await stub().createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "k_dedupe",
    });
    expect(reference).toBe("stub_sub_1");
    await stub().parseWebhookDeliveries(signed());
    await stub().simulateSuccessfulRenewal(reference);

    const first = await POST(signed());
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      received: 1,
      provider: "stub",
      applied: 1,
      duplicates: 0,
      ignored: 0,
      rejected: 0,
    });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]?.processed_at).not.toBeNull();
    expect(state.subs.find((s) => s.provider_ref === reference)?.status).toBe("active");

    // Provider redelivers the SAME native id: no second row, no second
    // state touch, still 200.
    stub().redeliverEvent("stub_evt_2");
    const second = await POST(signed());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      received: 1,
      provider: "stub",
      applied: 0,
      duplicates: 1,
      ignored: 0,
      rejected: 0,
    });
    expect(state.events).toHaveLength(1);
    expect(state.updates).toHaveLength(1);
    expect(state.subs.find((s) => s.provider_ref === reference)?.status).toBe("active");
  });

  it("returns 500 on genuine processing failure so the provider retries", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    // The processed-mark fails: applyBillingEvent propagates, the route
    // answers 500, and the stranded row keeps processed_at null so the
    // provider's redelivery adopts it instead of masking as duplicate.
    const state: FakeState = {
      subs: [trialingSub()],
      events: [],
      updates: [],
      failEventsUpdate: true,
    };
    mockDb(state);

    await stub().createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "k_fail",
    });
    await stub().parseWebhookDeliveries(signed());
    await stub().simulateSuccessfulRenewal("stub_sub_1");

    const res = await POST(signed());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "billing webhook failed" });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]?.processed_at).toBeNull();
  });

  it("falls back to synthetic ids for providers without native delivery ids", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    process.env.BILLING_PROVIDER = "synth";
    const event: BillingEvent = { type: "payment.failed", ref: "synth_sub_1", attempt: 1 };
    registerProvider({
      id: "synth",
      createCheckout: () => Promise.resolve({ reference: "synth-ref" }),
      cancelSubscription: () => Promise.resolve(),
      getSubscription: () =>
        Promise.resolve({
          ref: "synth-ref",
          planCode: "plus",
          status: "active" as const,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        }),
      parseWebhook: () => Promise.resolve([event]),
    });
    const state: FakeState = {
      subs: [trialingSub({ provider: "synth", provider_ref: "synth_sub_1" })],
      events: [],
      updates: [],
    };
    mockDb(state);

    const first = await POST(post());
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: 1, applied: 1 });

    // Same content redelivered: the synthetic id is deterministic, so the
    // second delivery dedupes instead of double-applying.
    const second = await POST(post());
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ received: 1, duplicates: 1 });
    expect(state.events).toHaveLength(1);
    expect(state.updates).toHaveLength(1);
  });

  it("logs structured delivery lines with no payload secrets", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    const state: FakeState = { subs: [trialingSub()], events: [], updates: [] };
    mockDb(state);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(String(line)));
    vi.spyOn(console, "warn").mockImplementation((line: string) => void logs.push(String(line)));
    vi.spyOn(console, "error").mockImplementation((line: string) => void logs.push(String(line)));

    await stub().createCheckout({
      householdId: "hh_1",
      planCode: "plus",
      idempotencyKey: "k_logs",
    });
    await stub().parseWebhookDeliveries(signed());
    await stub().simulateSuccessfulRenewal("stub_sub_1");
    const res = await POST(signed());
    expect(res.status).toBe(200);

    const blob = logs.join("\n");
    // The renewal carries amount 12900 NIO — none of the payload may leak.
    expect(blob).not.toContain("12900");
    expect(blob).not.toContain("NIO");
    expect(blob).not.toContain("payload");
    expect(blob).toContain("billing webhook delivery");
    expect(blob).toContain("payment.succeeded");
  });
});
