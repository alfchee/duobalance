-- Debt-kind (credit_card, loan) ledger accounts must store opening_balance as
-- the negative of what's owed, matching the sign convention transactions and
-- transfers already use: a charge is a negative account_amount (moves the
-- balance further from zero, i.e. more debt) and a payment is a positive
-- account_amount (moves it back toward zero, i.e. less debt). An account
-- created with a positive opening_balance breaks that convention — every
-- payment then adds to the positive total instead of paying it down.

update public.accounts
set opening_balance = -abs(opening_balance)
where balance_mode = 'ledger'
  and kind in ('credit_card', 'loan')
  and opening_balance > 0;

alter table public.accounts add constraint accounts_debt_opening_balance_sign
  check (
    balance_mode <> 'ledger'
    or kind not in ('credit_card', 'loan')
    or opening_balance <= 0
  );

comment on column public.accounts.opening_balance is
  'Signed in the account''s own currency. Computed balance = opening + sum(transactions). For ledger-mode credit_card/loan accounts this must be <= 0 (the negative of the amount owed) so that charges and payments move it in the correct direction — see accounts_debt_opening_balance_sign.';
