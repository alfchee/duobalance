-- Issue #23: transactions ledger refinement.
--
-- Cross-tenant visibility/isolation for transactions is already covered by
-- 02_tenant_isolation.sql and 07_authorization_matrix.sql (tests 3, 4, 6, 10,
-- 12 — entered_by immutability, spent_by independence, partner INSERT,
-- cross-tenant denial, and account-visibility inheritance respectively).
-- Category delete-in-use reassignment is covered by 11_categories_and_rules.sql.
--
-- This file covers what's left from the #23 acceptance criteria:
--   - base_amount is generated from amount * fx_rate and can't drift
--   - entered_by cannot be forged to a FELLOW household member either (RLS
--     pins it to the caller's own member id, not merely "a valid member")
--   - the containment trigger rejects a cross-household entered_by, spent_by,
--     account_id, and category_id
--   - deleting an account cascades its transactions

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_a          uuid := 'c0000000-0000-0000-0000-00000000000a';
  hh_b          uuid := 'd0000000-0000-0000-0000-00000000000b';
  alice_user    uuid := 'c1000000-0000-0000-0000-000000000001';
  bob_user      uuid := 'c1000000-0000-0000-0000-000000000002';
  carol_user    uuid := 'd1000000-0000-0000-0000-000000000001';
  alice_member  uuid := 'c2000000-0000-0000-0000-000000000001';
  bob_member    uuid := 'c2000000-0000-0000-0000-000000000002';
  carol_member  uuid := 'd2000000-0000-0000-0000-000000000001';
  acct_a        uuid := 'c3000000-0000-0000-0000-000000000001';
  acct_b        uuid := 'd3000000-0000-0000-0000-000000000001';
  cat_a         uuid := 'c4000000-0000-0000-0000-000000000001';
  cat_b         uuid := 'd4000000-0000-0000-0000-000000000001';
begin
  insert into auth.users (id, email) values
    (alice_user, 'alice23@test.local'),
    (bob_user,   'bob23@test.local'),
    (carol_user, 'carol23@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'Household A', 'CL', 'CLP', 'America/Santiago'),
    (hh_b, 'Household B', 'BR', 'BRL', 'America/Sao_Paulo');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (alice_member, hh_a, alice_user, 'owner',   'Alice'),
    (bob_member,   hh_a, bob_user,   'partner', 'Bob'),
    (carol_member, hh_b, carol_user, 'owner',   'Carol');

  insert into public.accounts (id, household_id, name, kind, currency) values
    (acct_a, hh_a, 'Household A checking', 'checking', 'CLP'),
    (acct_b, hh_b, 'Household B checking', 'checking', 'BRL');

  insert into public.categories (id, household_id, name) values
    (cat_a, hh_a, 'Groceries'),
    (cat_b, hh_b, 'Groceries');
end
$$;

select plan(11);

-- ============================================================================
-- 1. base_amount = round(amount * fx_rate, 4), always — never editable
--    directly and never allowed to drift.
-- ============================================================================

select tests.authenticate_as('c1000000-0000-0000-0000-000000000001');

select results_eq(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, fx_rate, currency,
        occurred_on, description, entered_by)
     values (
       'c0000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000001',
       'c4000000-0000-0000-0000-000000000001', -1000, 1.5, 'CLP', current_date,
       'fx snapshot', 'c2000000-0000-0000-0000-000000000001'
     )
     returning base_amount $$,
  $$ values (-1500.0000::numeric(18,4)) $$,
  'base_amount = round(amount * fx_rate, 4)'
);

select results_eq(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by)
     values (
       'c0000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000001',
       'c4000000-0000-0000-0000-000000000001', -750, 'CLP', current_date,
       'fx_rate defaults to 1', 'c2000000-0000-0000-0000-000000000001'
     )
     returning fx_rate, base_amount $$,
  $$ values (1::numeric(20,10), -750.0000::numeric(18,4)) $$,
  'fx_rate defaults to 1 and base_amount matches amount when currency == base'
);

select results_eq(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, fx_rate, currency,
        occurred_on, description, entered_by)
     values (
       'c0000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000001',
       'c4000000-0000-0000-0000-000000000001', -99999999999999.9999, 1.1, 'CLP', current_date,
       'maximum supported generated base amount', 'c2000000-0000-0000-0000-000000000001'
     )
     returning base_amount $$,
  $$ values (-109999999999999.9999::numeric(38,4)) $$,
  'base_amount supports every valid amount × fx_rate product'
);

-- ============================================================================
-- 2. entered_by is pinned to the CALLER's own member id, not merely "any
--    member of the household" — Bob cannot attribute a row to Alice even
--    though Alice is a fellow member of the same household.
-- ============================================================================

select tests.authenticate_as('c1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by)
     values (
       'c0000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000001',
       'c4000000-0000-0000-0000-000000000001', -200, 'CLP', current_date,
       'Bob forges Alice as entered_by', 'c2000000-0000-0000-0000-000000000001'
     ) $$,
  '42501',
  null,
  'Bob cannot forge entered_by to Alice, a fellow household member (RLS WITH CHECK)'
);

-- ============================================================================
-- 3. Containment trigger: entered_by, spent_by, account_id, and category_id
--    must each belong to the transaction's own household. Runs as superuser
--    (RLS bypassed) so the check under test is the trigger, not the INSERT
--    policy — mirrors the accounts containment tests in 07_authorization_matrix.
-- ============================================================================

select tests.clear_auth();

select throws_ok(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by)
     values (
       'c0000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000001',
       'c4000000-0000-0000-0000-000000000001', -100, 'CLP', current_date,
       'sneak', 'd2000000-0000-0000-0000-000000000001'
     ) $$,
  null,
  null,
  'containment: entered_by from another household rejected'
);

select throws_ok(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by, spent_by)
     values (
       'c0000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000001',
       'c4000000-0000-0000-0000-000000000001', -100, 'CLP', current_date,
       'sneak', 'c2000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001'
     ) $$,
  null,
  null,
  'containment: spent_by from another household rejected'
);

select throws_ok(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by)
     values (
       'c0000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-000000000001',
       'c4000000-0000-0000-0000-000000000001', -100, 'CLP', current_date,
       'sneak', 'c2000000-0000-0000-0000-000000000001'
     ) $$,
  null,
  null,
  'containment: account_id from another household rejected'
);

select throws_ok(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency,
        occurred_on, description, entered_by)
     values (
       'c0000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000001',
       'd4000000-0000-0000-0000-000000000001', -100, 'CLP', current_date,
       'sneak', 'c2000000-0000-0000-0000-000000000001'
     ) $$,
  null,
  null,
  'containment: category_id from another household rejected'
);

-- ============================================================================
-- 4. Deleting an account cascades its transactions (the #23 AC). Deleting a
--    category does NOT cascade — see 11_categories_and_rules.sql test 6.
-- ============================================================================

select results_eq(
  $$ insert into public.accounts (id, household_id, name, kind, currency)
     values ('c3000000-0000-0000-0000-000000000099', 'c0000000-0000-0000-0000-00000000000a',
             'Cascade Test Acc', 'checking', 'CLP')
     returning 1 $$,
  $$ values (1) $$,
  'setup: a fresh account exists to delete'
);

select results_eq(
  $$ insert into public.transactions
       (id, household_id, account_id, amount, currency, occurred_on, description, entered_by)
     values (
       'c6000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000a',
       'c3000000-0000-0000-0000-000000000099', -100, 'CLP', current_date,
       'about to be cascaded', 'c2000000-0000-0000-0000-000000000001'
     )
     returning 1 $$,
  $$ values (1) $$,
  'setup: a transaction exists against the fresh account'
);

delete from public.accounts where id = 'c3000000-0000-0000-0000-000000000099';

select is_empty(
  $$ select * from public.transactions where id = 'c6000000-0000-0000-0000-000000000001'::uuid $$,
  'deleting an account cascades its transactions'
);

select * from finish();
rollback;
