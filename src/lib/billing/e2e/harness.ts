import type { SupabaseClient } from "@supabase/supabase-js";
import type { Clock } from "../clock";
import { applyBillingEvent, type ApplyOutcome } from "../lifecycle";
import type { BillingEvent } from "../provider";
import { createStubForTests } from "../registry";
import type { Database } from "@/lib/supabase/types";

// End-to-end world for the #266 billing suite: one isolated stub on its own
// manual clock, one fake persistence layer, and delivery helpers that drain
// the stub outbox through the real port path (parseWebhook →
// applyBillingEvent), exactly like the webhook route will in production.
//
// The stub is resolved through `createStubForTests()` — never by importing
// the adapter — so the `billing/adapters` boundary keeps its single
// exemption (the registry). Time comes from the stub's injected clock only;
// a clock view over `stub.now()` keeps the ledger in sync without a second
// time source. No test here depends on real elapsed time.
//
// To add a case (see docs/billing-e2e-suite.md): createWorld → drive the
// stub (checkout / simulate* / advanceTime / redeliverEvent / injectEvents)
// → deliverAll/deliverOne → assert stub state AND fake-DB state agree.

export const E2E_START = new Date("2026-09-23T00:00:00.000Z");

export const STUB_SIGNATURE_HEADER = "x-stub-signature";
export const STUB_VALID_SIGNATURE = "stub-valid";

/** Stub type without importing the adapter (boundary): resolved via registry. */
export type E2EStub = ReturnType<typeof createStubForTests>;

export interface FakeSub {
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
}

export interface FakeEvent {
  provider: string;
  provider_event_id: string;
  subscription_id: string | null;
  type: string | null;
  payload: unknown;
  processed_at: string | null;
}

export interface E2EWorld {
  readonly tag: string;
  readonly stub: E2EStub;
  readonly db: SupabaseClient<Database>;
  readonly state: {
    subs: FakeSub[];
    events: FakeEvent[];
    updates: unknown[];
    deliveries: Array<{ subscription_id: string; stage: string }>;
  };
  readonly householdId: string;
  readonly planCode: string;
  reference: string | null;
}

interface Filter {
  col: string;
  op: string;
  value: unknown;
}

// Fake persistence layer: billing_events rows with 23505 dedupe plus
// chainable subscriptions select/insert/update with eq/in filtering. Same
// contract as the emulator in lifecycle-io.test.ts, extended with the
// comped plan so go-live scenarios validate (#263).
function createFakeDb(state: E2EWorld["state"]) {
  const matchSub = (row: FakeSub, filters: Filter[]) =>
    filters.every((f) =>
      f.op === "eq"
        ? (row as unknown as Record<string, unknown>)[f.col] === f.value
        : (f.value as unknown[]).includes((row as unknown as Record<string, unknown>)[f.col]),
    );
  const chainable = <T>(apply: (filters: Filter[]) => T) => {
    const filters: Filter[] = [];
    const chain: Record<string, unknown> = {};
    chain.eq = (col: string, value: unknown) => {
      filters.push({ col, op: "eq", value });
      return chain;
    };
    chain.in = (col: string, values: unknown) => {
      filters.push({ col, op: "in", value: values });
      return chain;
    };
    chain.then = (resolve: (v: unknown) => void) => resolve(apply(filters));
    chain.maybeSingle = async () => apply(filters);
    chain.single = async () => apply(filters);
    return chain;
  };
  const updateChain = (
    rows: Record<string, unknown>[],
    values: Record<string, unknown>,
    onWrite?: (id: unknown) => void,
  ) => {
    const filters: Filter[] = [];
    const chain: Record<string, unknown> = {};
    chain.eq = (col: string, value: unknown) => {
      filters.push({ col, op: "eq", value });
      return chain;
    };
    const run = () => {
      const matched = rows.filter((r) =>
        filters.every((f) => (r as Record<string, unknown>)[f.col] === f.value),
      );
      for (const m of matched) {
        Object.assign(m, values);
        onWrite?.((m as Record<string, unknown>).id);
      }
      return matched;
    };
    chain.select = (_cols: string) => ({
      then: (resolve: (v: unknown) => void) => resolve({ data: run(), error: null }),
    });
    chain.then = (resolve: (v: unknown) => void) => {
      run();
      resolve({ error: null });
    };
    return chain;
  };
  const from = (table: string) => {
    if (table === "billing_events") {
      return {
        insert: async (input: {
          provider: string;
          provider_event_id: string;
          subscription_id?: string | null;
          type?: string | null;
          payload?: unknown;
          processed_at?: string | null;
        }) => {
          const key = `${input.provider}|${input.provider_event_id}`;
          if (state.events.some((e) => `${e.provider}|${e.provider_event_id}` === key)) {
            return { error: { code: "23505", message: "duplicate key" } };
          }
          state.events.push({
            provider: input.provider,
            provider_event_id: input.provider_event_id,
            subscription_id: input.subscription_id ?? null,
            type: input.type ?? null,
            payload: input.payload ?? null,
            processed_at: input.processed_at ?? null,
          });
          return { error: null };
        },
        select: (_cols: string) =>
          chainable((filters) => ({
            data:
              state.events.find((e) =>
                filters.every((f) => (e as unknown as Record<string, unknown>)[f.col] === f.value),
              ) ?? null,
            error: null,
          })),
        update: (values: Record<string, unknown>) =>
          updateChain(state.events as unknown as Record<string, unknown>[], values),
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
            filters.push({ col, op: "eq", value });
            return chain;
          };
          chain.in = (col: string, values: unknown) => {
            filters.push({ col, op: "in", value: values });
            return chain;
          };
          chain.maybeSingle = async () => ({
            data: state.subs.find((r) => matchSub(r, filters)) ?? null,
            error: null,
          });
          chain.then = (resolve: (v: unknown) => void) =>
            resolve({ data: state.subs.filter((r) => matchSub(r, filters)), error: null });
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
        update: (values: Record<string, unknown>) =>
          updateChain(state.subs as unknown as Record<string, unknown>[], values, (id) =>
            state.updates?.push({ id, values }),
          ),
      };
    }
    if (table === "dunning_deliveries") {
      // Recovery cleanup (#265): applyBillingEvent deletes the cycle's rows
      // when a payment reactivates the subscription. No-op when absent.
      return {
        delete: () => ({
          eq: async (col: string, value: unknown) => {
            if (col === "subscription_id") {
              state.deliveries = state.deliveries.filter((d) => d.subscription_id !== value);
            }
            return { error: null };
          },
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  };
  return { from } as unknown as SupabaseClient<Database>;
}

/** Default subscription row shape; override per scenario (e.g. comped seed). */
export function baseSub(overrides: Partial<FakeSub> = {}): FakeSub {
  return {
    id: "sub_1",
    household_id: "e2e_hh_1",
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

export function createWorld(
  opts: { tag?: string; householdId?: string; planCode?: string } = {},
): E2EWorld {
  const tag = opts.tag ?? "w1";
  const state: E2EWorld["state"] = { subs: [], events: [], updates: [], deliveries: [] };
  return {
    tag,
    stub: createStubForTests(new Date(E2E_START)),
    db: createFakeDb(state),
    state,
    householdId: opts.householdId ?? `e2e_hh_${tag}`,
    planCode: opts.planCode ?? "plus",
    reference: null,
  };
}

/** Clock view over the stub's injected clock — always in sync, no second source. */
export function stubClock(stub: E2EStub): Clock {
  return { now: () => stub.now() };
}

export function signedWebhookRequest(): Request {
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { [STUB_SIGNATURE_HEADER]: STUB_VALID_SIGNATURE },
  });
}

/**
 * Drain the stub outbox through the real port path: verify signature via
 * parseWebhookEntries, then apply each event to the ledger under its real
 * provider event id (`stub_evt_N`). Redeliveries therefore carry the SAME id
 * as the original, so ledger dedupe on (provider, event id) is exercised on
 * every delivery — exactly like the webhook route in production.
 * Returns one outcome per delivered event, in arrival order.
 */
export async function deliverAll(world: E2EWorld): Promise<ApplyOutcome[]> {
  const outcomes: ApplyOutcome[] = [];
  while (world.stub.getOutboxSize() > 0) {
    const entries = await world.stub.parseWebhookEntries(signedWebhookRequest());
    for (const entry of entries) {
      outcomes.push(await deliverOne(world, entry.event, entry.id));
    }
  }
  return outcomes;
}

/** Apply a single event under an explicit provider event id (dedupe tests reuse ids). */
export async function deliverOne(
  world: E2EWorld,
  event: BillingEvent,
  providerEventId: string,
): Promise<ApplyOutcome> {
  return applyBillingEvent(
    world.db,
    { provider: "stub", providerEventId, event, householdId: world.householdId },
    stubClock(world.stub),
  );
}

/** Full checkout: provider checkout, then deliver the activation to the ledger. */
export async function checkout(
  world: E2EWorld,
  idempotencyKey?: string,
): Promise<{ reference: string; outcomes: ApplyOutcome[] }> {
  const { reference } = await world.stub.createCheckout({
    householdId: world.householdId,
    planCode: world.planCode,
    idempotencyKey: idempotencyKey ?? `e2e_${world.tag}_checkout`,
  });
  world.reference = reference;
  const outcomes = await deliverAll(world);
  return { reference, outcomes };
}

/** Ledger status for the world's subscription (null when no row yet). */
export function dbStatus(world: E2EWorld): string | null {
  return world.state.subs.find((s) => s.provider_ref === world.reference)?.status ?? null;
}

/** Provider-side status for the world's subscription. */
export async function stubStatus(world: E2EWorld): Promise<string> {
  if (!world.reference) throw new Error("e2e world has no checkout yet");
  return (await world.stub.getSubscription({ subscriptionRef: world.reference })).status;
}
