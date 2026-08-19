# Debug Session: Account Currency Balance

Status: [FIX IMPLEMENTED — AWAITING USER VERIFICATION]

## Symptom

An NIO account with an opening balance of 1,000 NIO displays 560 NIO after an expense of 440 USD whose converted amount is 16,178.36 NIO. The activity summary uses 16,178.36 NIO while the account balance subtracts 440.

## Expected Result

The account balance must apply the transaction amount converted to the account currency.

## Hypotheses

1. The account-balance aggregation uses the transaction source amount rather than the account-currency amount.
2. The transaction write stores the conversion only for display and does not persist a balance-ready normalized amount.
3. The balance UI uses a client-side calculation that does not select the conversion-aware field or database function.
4. The conversion direction or normalized amount is correct in activity data but omitted from the balance calculation.
5. The balance query cache is stale after mutation.

## Evidence

Confirmed by the pre-fix reproduction events in
`.dbg/trae-debug-log-account-currency-balance.ndjson`:

- The submitted transaction targets an NIO account, with `amount = -440`,
  `currency = USD`, and `fxRate = 36.769`; its account/base conversion is
  `-16,178.36 NIO`.
- The returned account row has `openingBalance = 1,000 NIO` and `balance = 560 NIO`.
- The account balance view calculates ledger balance as
  `opening_balance + sum(transactions.amount)`, so it subtracts raw USD 440
  from the NIO opening balance.

Hypothesis 1 is confirmed. Hypotheses 2 through 4 are contributing design gaps:
the schema has a base-currency normalized amount but no account-currency normalized
amount, while the ledger aggregation requires values in the account currency.
Hypothesis 5 is rejected: the fresh account query repeatedly returns the incorrect
persisted calculation.

## Next Step

Prepare a forward-only schema correction that persists an account-currency amount,
then update the ledger view and add regression coverage.

## Fix

Migration `20260824000000_account_currency_ledger_amounts.sql` persists a
transaction `account_amount` snapshot. For an account in the household base
currency it uses the existing transaction FX snapshot; otherwise it resolves the
entry-date cross-rate to the account currency. `account_balances` now aggregates
this account-currency amount.

The migration is sequenced after the current latest migration. It refreshes the
account-currency amount when a transaction's FX rate changes and prevents an
account currency change after ledger activity exists.

The regression test creates a 440 USD expense in an NIO account with a 36.769
NIO/USD rate and asserts both the stored `-16,178.36 NIO` account amount and the
resulting `-15,618.36 NIO` ledger balance from an opening amount of 200 NIO plus
the prior test transfer.

## Validation

`npm run db:reset`, `npm run db:types`, and `npm run db:test` pass (400 tests).
Temporary client instrumentation has been removed. User verification remains
required before debugging artifacts are cleaned up.
