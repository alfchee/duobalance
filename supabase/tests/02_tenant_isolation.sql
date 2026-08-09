-- Tenant isolation. The cardinal rule: a member of household A must NEVER
-- read or write household B's data. Tested on the transactions table because
-- it joins the most other tables and is the most likely place for a leak.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

-- Reference data (currencies come from migration 1, available globally)
-- (no need to seed currencies here)

-- Two households. Each gets one owner and one account.
-- UUIDs are hard-coded so the test is reproducible.
do $$
declare
  hh_a uuid := '11111111-1111-1111-1111-111111111111';
  hh_b uuid := '22222222-2222-2222-2222-222222222222';
  usr_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  usr_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  acct_a uuid := 'a1111111-1111-1111-1111-111111111111';
  acct_b uuid := 'b2222222-2222-2222-2222-222222222222';
  cat_a uuid := 'ac111111-1111-1111-1111-111111111111';
  cat_b uuid := 'bc222222-2222-2222-2222-222222222222';
  tx_a  uuid := 'aabbbbbb-1111-1111-1111-111111111111';
  tx_b  uuid := 'bbaaaaaa-2222-2222-2222-222222222222';
begin
  insert into auth.users (id, email) values
    (usr_a, 'alice@test.local'),
    (usr_b, 'bob@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'House A', 'CL', 'CLP', 'America/Santiago'),
    (hh_b, 'House B', 'BR', 'BRL', 'America/Sao_Paulo');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_a, usr_a, 'owner',   'Alice'),
    (hh_b, usr_b, 'owner',   'Bob');

  insert into public.accounts (id, household_id, name, kind, currency) values
    (acct_a, hh_a, 'Alice checking', 'checking', 'CLP'),
    (acct_b, hh_b, 'Bob checking',   'checking', 'BRL');

  insert into public.categories (id, household_id, name) values
    (cat_a, hh_a, 'Groceries'),
    (cat_b, hh_b, 'Groceries');

  insert into public.transactions
    (id, household_id, account_id, category_id, amount, currency, occurred_on, description, entered_by)
  values
    (tx_a, hh_a, acct_a, cat_a, -1000,  'CLP', current_date, 'Alice groceries',
       (select id from public.household_members where user_id = usr_a)),
    (tx_b, hh_b, acct_b, cat_b, -50,    'BRL', current_date, 'Bob groceries',
       (select id from public.household_members where user_id = usr_b));
end
$$;

select plan(8);

-- ============================================================================
-- As Alice (household A)
-- ============================================================================
select tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- 1. Alice sees her own household
select results_eq(
  $$ select count(*)::int from public.households $$,
  $$ values (1::int) $$,
  'Alice sees exactly one household'
);

-- 2. Alice sees her own account
select results_eq(
  $$ select count(*)::int from public.accounts $$,
  $$ values (1::int) $$,
  'Alice sees her own account'
);

-- 3. Alice sees her own transaction
select results_eq(
  $$ select count(*)::int from public.transactions $$,
  $$ values (1::int) $$,
  'Alice sees her own transaction'
);

-- 4. Alice cannot directly fetch Bob's transaction by id
select is_empty(
  $$ select * from public.transactions
     where id = 'bbaaaaaa-2222-2222-2222-222222222222'::uuid $$,
  'Alice cannot SELECT Bob transaction by id'
);

-- 5. Alice cannot insert a transaction into Bob's household. entered_by is
--    Bob's own member id (not Alice's) so the failure is isolated to the
--    RLS WITH CHECK — a mismatched entered_by would instead be rejected by
--    the transactions_containment trigger before RLS is ever reached.
select throws_ok(
  $$ insert into public.transactions
       (household_id, account_id, amount, currency, occurred_on, description, entered_by)
     values (
       '22222222-2222-2222-2222-222222222222',
       'b2222222-2222-2222-2222-222222222222',
       -100, 'BRL', current_date, 'sneak',
       (select id from public.household_members where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
     ) $$,
  '42501',
  null,
  'Alice cannot INSERT into Bob household (WITH CHECK fails)'
);

-- ============================================================================
-- As Bob (household B) — same assertions in the other direction
-- ============================================================================
select tests.authenticate_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- 6. Bob sees exactly one household (his own)
select results_eq(
  $$ select count(*)::int from public.households $$,
  $$ values (1::int) $$,
  'Bob sees exactly one household'
);

-- 7. Bob cannot see Alice's account
select is_empty(
  $$ select * from public.accounts
     where household_id = '11111111-1111-1111-1111-111111111111'::uuid $$,
  'Bob cannot see Alice account'
);

-- 8. Bob cannot update Alice's transaction
select results_eq(
  $$ with updated as (
       update public.transactions
         set description = 'pwned'
         where id = 'aabbbbbb-1111-1111-1111-111111111111'::uuid
         returning 1
     )
     select count(*)::int from updated $$,
  $$ values (0::int) $$,
  'Bob UPDATE on Alice transaction affects 0 rows (RLS blocks)'
);

select * from finish();
rollback;
