\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh uuid := 'a0000000-0000-0000-0000-000000000001';
  owner_user uuid := 'a1000000-0000-0000-0000-000000000001';
  owner_member uuid := 'a2000000-0000-0000-0000-000000000001';
begin
  insert into auth.users (id, email) values (owner_user, 'debtsign@test.local');
  insert into public.households (id, name, country, base_currency, timezone) values
    (hh, 'Debt Sign', 'CL', 'CLP', 'America/Santiago');
  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_member, hh, owner_user, 'owner', 'Owner');
end
$$;

select plan(5);

select throws_ok(
  $$ insert into public.accounts
       (household_id, name, kind, currency, opening_balance, balance_mode, is_shared)
     values
       ('a0000000-0000-0000-0000-000000000001', 'Credit card', 'credit_card', 'CLP', 69219.75, 'ledger', true) $$,
  '23514',
  'new row for relation "accounts" violates check constraint "accounts_debt_opening_balance_sign"',
  'a ledger-mode credit card cannot open with a positive owed amount'
);

select throws_ok(
  $$ insert into public.accounts
       (household_id, name, kind, currency, opening_balance, balance_mode, is_shared)
     values
       ('a0000000-0000-0000-0000-000000000001', 'Loan', 'loan', 'CLP', 500, 'ledger', true) $$,
  '23514',
  'new row for relation "accounts" violates check constraint "accounts_debt_opening_balance_sign"',
  'a ledger-mode loan cannot open with a positive owed amount'
);

select lives_ok(
  $$ insert into public.accounts
       (household_id, name, kind, currency, opening_balance, balance_mode, is_shared)
     values
       ('a0000000-0000-0000-0000-000000000001', 'Credit card ok', 'credit_card', 'CLP', -69219.75, 'ledger', true) $$,
  'a ledger-mode credit card can open with a negative (owed) balance'
);

select lives_ok(
  $$ insert into public.accounts
       (household_id, name, kind, currency, opening_balance, manual_balance, balance_mode, is_shared)
     values
       ('a0000000-0000-0000-0000-000000000001', 'Manual credit card', 'credit_card', 'CLP', 69219.75, 69219.75, 'manual', true) $$,
  'manual-mode credit cards are exempt — the sign never feeds a running total'
);

select lives_ok(
  $$ insert into public.accounts
       (household_id, name, kind, currency, opening_balance, balance_mode, is_shared)
     values
       ('a0000000-0000-0000-0000-000000000001', 'Checking', 'checking', 'CLP', 5000, 'ledger', true) $$,
  'asset kinds are unaffected and can open with a positive balance'
);

select * from finish();
rollback;
