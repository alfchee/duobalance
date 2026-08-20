# Debug Session: Remote Migration Transfer Backfill

Status: [RESOLVED — VERIFIED LOCALLY, READY FOR REMOTE RETRY]

## Symptom

Applying `20260824000000_account_currency_ledger_amounts.sql` to the remote database fails while backfilling `transactions.account_amount` with `transfers must be deleted and recreated` (`23514`).

## Hypotheses

1. The account amount backfill updates existing transfer legs.
2. The transfer update guard blocks the backfill because it treats all transfer-leg updates as user edits.
3. A migration-scoped bypass can preserve the guard for all regular writes.
4. The failed migration transaction rolled back completely on the remote database.

## Evidence

The remote migration output identifies the `update public.transactions` backfill as the failing statement and reports the transfer update guard's exact message.

Hypothesis 1 is confirmed: the backfill updates historical transfer legs.
Hypothesis 2 is confirmed: `transactions_prevent_transfer_update` rejects every
transfer-leg update. A session setting is rejected as a solution because it would
allow application clients to bypass the transfer protection. The migration now
temporarily disables only this trigger during its transaction-scoped administrative
backfill and immediately re-enables it.

The second remote attempt confirms a separate `transactions_protect_transfer_group`
trigger also rejects updates to transfer legs. The backfill now temporarily disables
both transfer-specific update guards and restores both before the migration completes.

## Verification

Confirmed against real transfer-leg rows, not just the seed data (`db:reset`'s
seed has zero `transfer_group_id` rows, so it alone couldn't prove the fix):

- Created a household/accounts/transfer fixture by hand and called
  `create_transfer` directly, then replayed the migration's exact
  disable → backfill `update` → enable sequence against those two transfer
  legs. It completed with no error and produced the expected `account_amount`
  for both legs.
- `npm run db:test` (402 tests, includes
  `13_transfers_and_account_balances.sql`) still passes, confirming an
  ordinary attempt to update a transfer leg (outside the migration's
  temporary disable window) is still rejected by both guard triggers.

## Residual risk (not yet hit, flagging for the next push)

The backfill's cross-currency branch (`else round(t.amount * fx_rate_on(...), 4)`)
only runs for a row whose transaction currency differs from both its account's
currency and the household's base currency. `fx_rate_on` raises (does not
return null) when it has no rate on or before that row's `occurred_on`. Transfer
legs can't hit this — `create_transfer` always records each leg in its own
account's currency, so the `t.currency = a.currency` branch always wins for
transfers. It's only a risk for a pre-existing _non-transfer_ transaction
entered in a third currency, on a date older than the household's FX history.
Not something reproducible from local data — worth watching for on the retry,
not worth guessing a fallback for without knowing what remote's real history
contains.

## Next Step

Re-run `supabase db push`. The trigger-guard issue that produced both prior
failures is fixed and verified; nothing else in this migration is known to be
broken.
