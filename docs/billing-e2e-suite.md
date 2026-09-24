# Billing end-to-end suite (#266)

Contract the Phase B provider adapter must satisfy. Written against the
`PaymentProvider` port — never against a provider's quirks — so the
adapter arrives with a specification instead of assumptions.

## Map

Port-level (vitest, `src/lib/billing/e2e/`, harness `harness.ts`):

| File                            | Proves                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `happy-path.test.ts`            | Checkout → trial → renewal → active → cancel → sweeper expiry, asserted on stub AND ledger                                                        |
| `dunning.test.ts`               | Failed payments walk past_due → grace → expired; grace window off the injected clock; attempt counting                                            |
| `reactivation.test.ts`          | Expired and cancelled both exit through reactivation; full failure arc replays through the ledger first                                           |
| `webhooks.test.ts`              | Duplicate delivery collapses to one state change; stale post-cancel payment ignored; unknown refs rejected; unsigned delivery refused at the port |
| `go-live.test.ts`               | Simulated go-live (`BILLING_ENABLED=1`): comped row sweeper-immune and entitled; downgraded row expired and not entitled                          |
| `lifecycle-coverage.test.ts`    | All six lifecycle states reached through real stub operations; ledger observes every hop                                                          |
| `../state-machine-lock.test.ts` | Pins the full `TRANSITIONS` table — any added/removed/re-targeted transition fails until the suite is updated                                     |

Database-level (pgTAP, `supabase/tests/30_billing_lifecycle_e2e.sql`):

| Section      | Proves                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Baseline  | Entitled member writes before the downgrade                                                                                                         |
| B. Downgrade | Lapsed subscription → no plan, no `write_access`, `can_write` false; INSERT refused by the fail-closed trigger, UPDATE affects 0 rows (RLS `USING`) |
| C. Go-live   | Comped household keeps `write_access`, inserts and updates succeed, row stays dateless-active                                                       |

## Run

```bash
npx vitest run src/lib/billing/e2e      # port half (seconds, no real time)
npm run db:test                          # DB half (needs the local stack)
npm run test                             # everything, as CI runs it
```

The whole suite runs in CI on every PR: vitest via `npm run check`,
pgTAP via `db:test`. Full local vitest run is ~30s; the e2e directory
alone is a few seconds — comfortably inside the 60s budget.

## Adding a case (a real provider misbehaves in a new way)

1. **Reproduce at the port first.** New file (or extend) under
   `src/lib/billing/e2e/`: `createWorld()` → drive the stub
   (`createCheckout`, `simulate*`, `advanceTime`, `redeliverEvent`,
   `injectEvents` for wire shapes the stub cannot produce) →
   `deliverAll`/`deliverOne` → assert stub state AND `world.state`
   agree. Never import the adapter — resolve via `createStubForTests()`
   (the registry keeps the single `billing/adapters` exemption).
2. **Mirror at the ledger if it touches persistence.** If the case
   changes what `applyBillingEvent` must do, extend the harness fake
   (plans, chains) the same way `lifecycle-io.test.ts` does.
3. **Mirror at the database if enforcement is involved.** Extend file 30
   following the 28/29 fixture pattern (`tests.authenticate_as`,
   fixed 30* UUIDs, `plan(N)` updated to match).
4. **If the state machine must change**, update `TRANSITIONS` AND the
   lock test in the same commit — the lock exists to force exactly that.
5. Time-travel with `stub.advanceTime()` / `ManualClock` only. A test
   that needs `sleep` or wall-clock is a bug in the test.
