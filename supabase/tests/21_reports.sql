\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(16);

do $$
declare
  hh_a uuid := '21000000-0000-0000-0000-000000000001';
  hh_b uuid := '21000000-0000-0000-0000-000000000002';
  alice_user uuid := '21000000-0000-0000-0000-000000000011';
  bob_user uuid := '21000000-0000-0000-0000-000000000012';
  carol_user uuid := '21000000-0000-0000-0000-000000000013';
  alice_member uuid := '21000000-0000-0000-0000-000000000021';
  bob_member uuid := '21000000-0000-0000-0000-000000000022';
  carol_member uuid := '21000000-0000-0000-0000-000000000023';
  account_a uuid := '21000000-0000-0000-0000-000000000031';
  account_b uuid := '21000000-0000-0000-0000-000000000032';
  transfer_account uuid := '21000000-0000-0000-0000-000000000033';
  bob_private_account uuid := '21000000-0000-0000-0000-000000000034';
  expense_category uuid := '21000000-0000-0000-0000-000000000041';
  income_category uuid := '21000000-0000-0000-0000-000000000042';
begin
  insert into auth.users (id, email) values
    (alice_user, 'alice105@test.local'),
    (bob_user, 'bob105@test.local'),
    (carol_user, 'carol105@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'Reports household', 'CL', 'CLP', 'America/Santiago'),
    (hh_b, 'Other household', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (alice_member, hh_a, alice_user, 'owner', 'Alice'),
    (bob_member, hh_a, bob_user, 'partner', 'Bob'),
    (carol_member, hh_b, carol_user, 'owner', 'Carol');

  insert into public.accounts (id, household_id, name, kind, currency, is_shared, owner_member_id) values
    (account_a, hh_a, 'Reports account', 'checking', 'CLP', true, null),
    (account_b, hh_b, 'Other account', 'checking', 'CLP', true, null),
    (transfer_account, hh_a, 'Transfer account', 'checking', 'CLP', true, null),
    (bob_private_account, hh_a, 'Bob private account', 'checking', 'CLP', false, bob_member);

  insert into public.categories (id, household_id, name, kind, color_hex) values
    (expense_category, hh_a, 'Food', 'expense', '#ef4444'),
    (income_category, hh_a, 'Salary', 'income', '#22c55e');

  insert into public.transactions
    (household_id, account_id, category_id, amount, fx_rate, currency, occurred_on, description, entered_by, spent_by, transfer_group_id)
  values
    (hh_a, account_a, expense_category, -100, 1, 'CLP', '2026-08-05', 'Food', alice_member, alice_member, null),
    (hh_a, account_a, null, -25, 2, 'USD', '2026-08-06', 'Uncategorized foreign expense', alice_member, bob_member, null),
    (hh_a, account_a, income_category, 200, 1, 'CLP', '2026-08-07', 'Salary', alice_member, alice_member, null),
    (hh_a, account_a, expense_category, 20, 1, 'CLP', '2026-08-08', 'Refund', alice_member, alice_member, null),
    -- Owned privately by Bob: invisible to Alice's household-level report
    -- (accounts_select/transactions_select hide it from anyone but its
    -- owner), visible in Bob's own view. See the two "private account"
    -- assertions below.
    (hh_a, bob_private_account, expense_category, -777, 1, 'CLP', '2026-08-12', 'Private stuff', bob_member, bob_member, null),
    -- Other household's own transaction, so the cross-household isolation
    -- assertions below prove RLS actually filters real data rather than
    -- trivially passing against an empty household.
    (hh_b, account_b, null, -300, 1, 'CLP', '2026-08-13', 'Other household expense', carol_member, carol_member, null);
end;
$$;

select tests.authenticate_as('21000000-0000-0000-0000-000000000011');

select lives_ok(
  $$ select public.create_transfer(
       '21000000-0000-0000-0000-000000000001',
       '21000000-0000-0000-0000-000000000031',
       '21000000-0000-0000-0000-000000000033',
       500, 500, 1, 1, '2026-08-09', 'Transfer'
     ) $$,
  'setup: a transfer is created through its protected RPC'
);

select results_eq(
  $$ select period_month, income::numeric, expense::numeric, net::numeric
     from public.report_monthly_totals('21000000-0000-0000-0000-000000000001', '2026-08-01', '2026-08-31') $$,
  $$ values ('2026-08-01'::date, 220::numeric, 150::numeric, 70::numeric) $$,
  'monthly totals aggregate base_amount, exclude transfers, and classify refunds as income'
);

select results_eq(
  $$ select income::numeric, expense::numeric, net::numeric
     from public.report_monthly_totals('21000000-0000-0000-0000-000000000001', '2026-08-01', '2026-08-31', '21000000-0000-0000-0000-000000000021') $$,
  $$ values (220::numeric, 100::numeric, 120::numeric) $$,
  'monthly totals filter by member'
);

select results_eq(
  $$ select category_id, category_name, color_hex, total::numeric, txn_count
     from public.report_category_totals('21000000-0000-0000-0000-000000000001', '2026-08-01', '2026-08-31', 'expense') $$,
  $$ values
       ('21000000-0000-0000-0000-000000000041'::uuid, 'Food'::text, '#ef4444'::text, 100::numeric, 1::bigint),
       (null::uuid, null::text, '#9ca3af'::text, 50::numeric, 1::bigint) $$,
  'category expense totals include uncategorized transactions and base amounts'
);

select results_eq(
  $$ select category_id, total::numeric, txn_count
     from public.report_category_totals('21000000-0000-0000-0000-000000000001', '2026-08-01', '2026-08-31', 'income') $$,
  $$ values
       ('21000000-0000-0000-0000-000000000042'::uuid, 200::numeric, 1::bigint),
       ('21000000-0000-0000-0000-000000000041'::uuid, 20::numeric, 1::bigint) $$,
  'category income totals classify a refund by its positive base amount'
);

select results_eq(
  $$ select category_id, total::numeric
     from public.report_category_totals('21000000-0000-0000-0000-000000000001', '2026-08-01', '2026-08-31', 'expense', '21000000-0000-0000-0000-000000000022') $$,
  $$ values (null::uuid, 50::numeric) $$,
  'category totals filter by member'
);

select results_eq(
  $$ select sum(total)::numeric
     from public.report_category_totals('21000000-0000-0000-0000-000000000001', '2026-08-01', '2026-08-31', 'expense') $$,
  $$ select sum(expense)::numeric
     from public.report_monthly_totals('21000000-0000-0000-0000-000000000001', '2026-08-01', '2026-08-31') $$,
  'category expense total reconciles with monthly expense total'
);

select lives_ok(
  $$ insert into public.transactions
       (household_id, account_id, category_id, amount, currency, occurred_on, description, entered_by, spent_by)
     values (
       '21000000-0000-0000-0000-000000000001',
       '21000000-0000-0000-0000-000000000031',
       '21000000-0000-0000-0000-000000000041',
       -1, 'CLP', '2026-07-15', 'Expense-only month',
       '21000000-0000-0000-0000-000000000021',
       '21000000-0000-0000-0000-000000000021'
     ) $$,
  'setup: an expense-only month exists'
);

select results_eq(
  $$ select income::numeric, expense::numeric, net::numeric
     from public.report_monthly_totals('21000000-0000-0000-0000-000000000001', '2026-07-01', '2026-07-31') $$,
  $$ values (0::numeric, 1::numeric, -1::numeric) $$,
  'an expense-only month returns income zero instead of null'
);

select is_empty(
  $$ select * from public.report_monthly_totals('21000000-0000-0000-0000-000000000001', '2026-01-01', '2026-01-31') $$,
  'a date range with no transactions returns zero rows rather than a zeroed row'
);

-- The August assertions above (lines computed while authenticated as Alice)
-- already prove Bob's private transaction (-777) is invisible to Alice's
-- household-level report: their expected values are unchanged from before
-- that transaction existed. Here we confirm the other half — Bob himself,
-- as the private account's owner, does see it.
select tests.authenticate_as('21000000-0000-0000-0000-000000000012');

select results_eq(
  $$ select income::numeric, expense::numeric, net::numeric
     from public.report_monthly_totals('21000000-0000-0000-0000-000000000001', '2026-08-01', '2026-08-31') $$,
  $$ values (220::numeric, 927::numeric, -707::numeric) $$,
  'the private account owner sees their own private transaction in the report'
);

select tests.authenticate_as('21000000-0000-0000-0000-000000000011');

select is_empty(
  $$ select * from public.report_monthly_totals('21000000-0000-0000-0000-000000000002', '2026-08-01', '2026-08-31') $$,
  'security invoker prevents a cross-household monthly report (other household has real transactions)'
);

select is_empty(
  $$ select * from public.report_category_totals('21000000-0000-0000-0000-000000000002', '2026-08-01', '2026-08-31', 'expense') $$,
  'security invoker prevents a cross-household category report (other household has real transactions)'
);

select tests.authenticate_anon();

select throws_ok(
  $$ select * from public.report_monthly_totals('21000000-0000-0000-0000-000000000001', '2026-08-01', '2026-08-31') $$,
  '42501',
  null,
  'anon has no EXECUTE grant on report_monthly_totals'
);

select throws_ok(
  $$ select * from public.report_category_totals('21000000-0000-0000-0000-000000000001', '2026-08-01', '2026-08-31', 'expense') $$,
  '42501',
  null,
  'anon has no EXECUTE grant on report_category_totals'
);

select tests.authenticate_as('21000000-0000-0000-0000-000000000011');

select throws_ok(
  $$ select * from public.report_category_totals('21000000-0000-0000-0000-000000000001', '2026-08-01', '2026-08-31', 'invalid') $$,
  '22023',
  'p_kind must be expense or income, got invalid',
  'an invalid category report kind raises an error'
);

select * from finish();
rollback;
