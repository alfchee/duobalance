# ADR 0004 — Subscription lifecycle state machine

- Status: Accepted (2026-09-23)
- Decides: #260
- Parent epic: #255 (Phase A: SaaS layer, provider-independent)
- Follows: ADR 0003 (stub and clock)

## Context

The applier consumes only `BillingEvent` and knows nothing about providers.
A silent wrong transition here means a paying user losing access or a
non-paying user keeping it, so unexpected events must be rejected and
recorded rather than applied. The entitled-status list lives in
`household_plan()` and the partial unique index (#257) — this module moves
rows between statuses without re-encoding that list.

## Decision

- **Transition table as data** (`TRANSITIONS` in
  `src/lib/billing/lifecycle.ts`): every (from × event) cell is explicit,
  including `same` (harmless rewrite), `ignore` (stale money/retries on
  terminal statuses — mirrors the stub #259), and `reject`. Unknown event
  types fall back to reject. Tests pin every diagram cell, so diagram drift
  fails loudly.
- **Pure planner + thin I/O.** `planEventApplication` (pure, needs
  `householdId` only on the creation path) is exhaustively tested without
  mocks; `applyBillingEvent` selects the row, then inserts the event linked
  to it (`subscription_id`, backfilled after creation) as the dedupe gate —
  a 23505 conflict returns `duplicate` and touches nothing, so redelivery
  changes state once. Unknown types, invalid transitions, and malformed
  dates are recorded and returned as rejected, never thrown (planning runs
  inside a capture for exactly this reason — otherwise the retry would
  mask the failure as a silent duplicate).
- **Creation needs a plan carrier.** Only `subscription.activated` opens a
  row (it carries the plan code and seeds `trial_ends_at`; `payment.succeeded`
  carries no plan, so first-contact success is rejected and logged). The
  plan code is pre-checked so a bogus code is a recorded rejection, not a
  FK 500 loop; lost creation races are distinguished by constraint — same
  provider entity → `duplicate`, second live row (`subscriptions_one_live`)
  → `rejected`. Checkout context supplies `householdId` (#264 wires it).
- **Activation moves the plan.** Every `subscription.activated` transition
  upserts `plan_code` (`takePlanCode`), so upgrades, downgrades, and
  reactivations never leave the row on a stale plan.
- **Sweeper expires what time ended** (`expireDueSubscriptions`, daily
  `/api/cron/billing-expire` on the service role behind the cron secret):
  past_due/grace past `grace_ends_at`, cancelled past (or without) its
  period end — the null-period arm matters because `household_plan`
  coalesces nulls to infinity, so an unflipped row would squat the one-live
  slot and stay entitled forever — and trialing past `trial_ends_at`
  (ADR 0001 auto-downgrade). Active rows are never swept: a lapsed paid
  period with no failed-payment event is dunning's (#265) call. No
  `billing_events` rows are written (that table is provider deliveries
  only); idempotency comes from the status flip — a second run selects
  nothing and updates zero rows.
- **`grace_ends_at` on every past_due/grace entry** (the DB check
  constraint requires it), cleared on recovery; `cancel_at_period_end`
  set on cancel so the row stays entitled until the period ends, then the
  sweeper expires it.

## Consequences

- #267 (webhook route) calls `applyBillingEvent` per delivery with the
  provider's event id; #265 (dunning) owns retry timing and emails.
- Reactivation flows through `subscription.activated` from both cancelled
  and expired, matching the stub model.
