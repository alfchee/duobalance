# ADR 0003 — StubPaymentProvider with injectable clock

- Status: Accepted (2026-09-23)
- Decides: #259
- Parent epic: #255 (Phase A: SaaS layer, provider-independent)
- Follows: ADR 0002 (port and boundary)

## Context

The hardest billing logic — dunning, grace, reactivation, duplicate and
out-of-order webhooks — must be covered by tests before any provider is
chosen. Without an injectable clock those tests need real elapsed time and
will simply not be written.

## Decision

- **Clock abstraction** (`src/lib/billing/clock.ts`): `Clock` with
  `SystemClock` (production, debug surface default is manual — see below)
  and `ManualClock` (tests, debug sandbox). `addDays` does whole-day UTC
  date math for trial/renewal/grace windows. No billing code reads the wall
  clock; the eslint `billing/clock` entry bans `Date.now()` and
  argument-less `new Date()` under `src/lib/billing/` (fixed dates and
  defensive copies carry arguments and are fine), with `boundary.test.ts`
  text-scanning the exempt files (`clock.ts` itself, tests).
- **In-memory local tables, no migration.** The stub keeps subscriptions
  keyed by provider ref plus an event log with stub event ids, both in
  Maps. A test double must stay ephemeral, deterministic, and free of
  RLS/tenant coupling — a real table would buy nothing and cost a migration
  plus async I/O in every lifecycle test.
- **Explicit transitions, no lazy time travel.** Tests drive state via
  `advanceTo` (pure jump, no events), `simulateSuccessfulRenewal`,
  `simulateFailedRenewal` (attempt 1 → `past_due`, 2 → `grace`,
  3 → `expired`), `reactivate`, and `cancelSubscription`; the injected
  clock proves the 30-day trial and 7-day grace windows compute correctly.
  Reads never mutate state.
- **Cancelled/expired are terminal for payment events.** A stale
  `payment.succeeded` arriving after `subscription.cancelled` is ignored;
  only `subscription.activated` reactivates. `redeliverEvent` re-queues
  without touching state (N redeliveries = the one original state change);
  `injectEvents` applies out-of-order arrivals with an applied/ignored
  summary. The production state machine (#260) mirrors this precedence
  against the database.
- **Debug surface** (`POST /api/billing/debug`, POST-only so Tauri static
  export skips it): 404 in production (checked before auth) and on Tauri
  builds; authenticated users only elsewhere. It drives a dedicated
  manual-clock sandbox via `getStubForDebug()` in the registry — the route
  never imports an adapter, so the #258 boundary keeps its single
  exemption. There is no admin role yet; the admin app (#271) takes over
  authorization. Manual-clock start is a fixed date for determinism.

## Consequences

- The full lifecycle (trialing → active → past_due → grace → cancelled →
  expired → reactivated) runs in one test in milliseconds.
- Default renewal charge is the ADR 0001 plus-monthly (C$129 → 12900 minor
  units NIO); tests override per case.
- Real adapters land later without touching any of this; #266 exercises the
  suite through the same port.
