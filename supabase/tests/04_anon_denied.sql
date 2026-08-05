-- Anonymous (unauthenticated) traffic must not be able to read or write
-- any household-scoped data. The reference tables (currencies, fx_rates)
-- DO allow anon reads — but anon should never see accounts, transactions, etc.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_id  uuid := '44444444-4444-4444-4444-444444444444';
  usr_id uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  acct_id uuid := 'fa111111-1111-1111-1111-111111111111';
  cat_id  uuid := 'fc111111-1111-1111-1111-111111111111';
begin
  insert into auth.users (id, email) values
    (usr_id, 'someone@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_id, 'Secret', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_id, usr_id, 'owner', 'Member');

  insert into public.accounts (id, household_id, name, type, currency) values
    (acct_id, hh_id, 'Hidden', 'checking', 'CLP');

  insert into public.categories (id, household_id, name) values
    (cat_id, hh_id, 'Secret category');
end
$$;

select plan(5);

-- Switch to anon role
select tests.authenticate_anon();

-- 1. Anon cannot see households
select is_empty(
  $$ select * from public.households $$,
  'anon SELECT on households: empty'
);

-- 2. Anon cannot see accounts
select is_empty(
  $$ select * from public.accounts $$,
  'anon SELECT on accounts: empty'
);

-- 3. Anon cannot see transactions
select is_empty(
  $$ select * from public.transactions $$,
  'anon SELECT on transactions: empty'
);

-- 4. Anon cannot see household_members
select is_empty(
  $$ select * from public.household_members $$,
  'anon SELECT on household_members: empty'
);

-- 5. Anon cannot insert an account
select throws_ok(
  $$ insert into public.accounts (household_id, name, type, currency)
     values ('44444444-4444-4444-4444-444444444444', 'pwn', 'checking', 'CLP') $$,
  '42501',
  null,
  'anon cannot INSERT an account'
);

select * from finish();
rollback;
