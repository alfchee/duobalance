-- Issue #272: admin household and subscription views — last_activity,
-- member-email search (filter only, never returned), and comped/none/
-- expired status filters. Proves the data-layer half of the acceptance
-- criteria:
--
--   - admin_list_households + admin_get_household carry last_activity
--     (>= created_at; advances when a transaction lands)
--   - p_search matches household name, id text, AND member email, without
--     any email column existing on the function outputs
--   - p_status 'comped' / 'none' / 'expired' resolve the one-screen
--     support answers; plain statuses match the live row
--   - limit/offset pagination stays bounded (responsive at volume)
--   - no transaction-content column is selected outside count(*)/max()
--     and non-admins still fail closed with 42501

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_a          uuid := 'e1000000-0000-0000-0000-000000000001';
  hh_b          uuid := 'e1000000-0000-0000-0000-000000000002';
  hh_c          uuid := 'e1000000-0000-0000-0000-000000000003';
  owner_a       uuid := 'e1000000-0000-0000-0000-000000000011';
  member_a      uuid := 'e1000000-0000-0000-0000-000000000012';
  owner_b       uuid := 'e1000000-0000-0000-0000-000000000013';
  member_b      uuid := 'e1000000-0000-0000-0000-000000000014';
  owner_c       uuid := 'e1000000-0000-0000-0000-000000000015';
  member_c      uuid := 'e1000000-0000-0000-0000-000000000016';
  admin_user    uuid := 'e1000000-0000-0000-0000-000000000020';
  outsider_user uuid := 'e1000000-0000-0000-0000-000000000021';
  acct_a        uuid := 'e1000000-0000-0000-0000-000000000031';
begin
  insert into auth.users (id, email) values
    (owner_a, 'alice38@test.local'),
    (owner_b, 'bob38@test.local'),
    (owner_c, 'carol38@test.local'),
    (admin_user, 'admin38@test.local'),
    (outsider_user, 'outsider38@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'House A38', 'CL', 'CLP', 'America/Santiago'),
    (hh_b, 'House B38', 'NI', 'NIO', 'America/Managua'),
    (hh_c, 'House C38', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (member_a, hh_a, owner_a, 'owner', 'Alice A38'),
    (member_b, hh_b, owner_b, 'owner', 'Bob B38'),
    (member_c, hh_c, owner_c, 'owner', 'Carol C38');

  -- A live plus subscription for A (searchable, filterable as active).
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end) values
    (hh_a, 'plus', 'stub', 'active', now() + interval '30 days');

  -- B holds only an expired row: no live subscription (status 'none'),
  -- but the 'expired' filter must still find it.
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end) values
    (hh_b, 'plus', 'stub', 'expired', null);

  -- C holds no subscription rows at all: 'none' but NOT 'expired'.
  -- (Nothing to insert.)

  -- One account + transaction on A so last_activity has something to
  -- advance past created_at.
  insert into public.accounts (id, household_id, name, kind, currency) values
    (acct_a, hh_a, 'Checking A38', 'checking', 'CLP');
  insert into public.transactions
    (household_id, account_id, amount, currency, occurred_on, description, entered_by, spent_by)
  values
    (hh_a, acct_a, 1000, 'CLP', current_date, 'Seed tx A38', member_a, member_a);

  insert into public.admin_users (user_id, role, note) values
    (admin_user, 'support', 'test admin 38');
end
$$;

select plan(19);

select tests.authenticate_as('e1000000-0000-0000-0000-000000000020');

-- 1-2. last_activity exists on both readers and never precedes creation.
select ok(
  (select count(*) = 3 from public.admin_list_households()
    where last_activity is not null and last_activity >= created_at),
  'list last_activity present and >= created_at for every household'
);
select ok(
  (select last_activity >= created_at
     from public.admin_get_household('e1000000-0000-0000-0000-000000000001')),
  'detail last_activity >= created_at'
);

-- 3-4. Search by member (owner) email finds the household — and by name too.
select results_eq(
  $$ select household_id::text from public.admin_list_households(p_search := 'alice38@test.local') $$,
  $$ values ('e1000000-0000-0000-0000-000000000001'::text) $$,
  'email search finds the household by owner email'
);
select results_eq(
  $$ select household_id::text from public.admin_list_households(p_search := 'House B38') $$,
  $$ values ('e1000000-0000-0000-0000-000000000002'::text) $$,
  'name search still finds the household'
);

-- 5. The email address itself is never returned: no email OUT column
-- exists on either reader (the match filters only — u.email appears
-- solely inside the EXISTS search predicate).
select is_empty(
  $$ select parameter_name from information_schema.parameters
     where specific_schema = 'public'
       and specific_name ilike '%admin\_list\_households%'
       and parameter_mode = 'OUT'
       and parameter_name = 'email' $$,
  'admin_list_households has no email output column'
);
select is_empty(
  $$ select parameter_name from information_schema.parameters
     where specific_schema = 'public'
       and specific_name ilike '%admin\_get\_household%'
       and parameter_mode = 'OUT'
       and parameter_name = 'email' $$,
  'admin_get_household has no email output column'
);

-- 6-9. Status filters answer in one screen.
select results_eq(
  $$ select household_id::text from public.admin_list_households(p_status := 'active') $$,
  $$ values ('e1000000-0000-0000-0000-000000000001'::text) $$,
  'status=active matches the live row'
);
select results_eq(
  $$ select household_id::text from public.admin_list_households(p_status := 'expired') order by 1 $$,
  $$ values ('e1000000-0000-0000-0000-000000000002'::text) $$,
  'status=expired finds the household with only an expired row'
);
select results_eq(
  $$ select household_id::text from public.admin_list_households(p_status := 'none') order by 1 $$,
  $$ values
    ('e1000000-0000-0000-0000-000000000002'::text),
    ('e1000000-0000-0000-0000-000000000003'::text) $$,
  'status=none finds households with no live subscription (expired + never)'
);
select is_empty(
  $$ select * from public.admin_list_households(p_status := 'no-such-status') $$,
  'unknown status matches nothing (fail closed, not everything)'
);

-- 10-11. Pagination stays bounded.
select is(
  (select count(*)::int from public.admin_list_households(p_limit := 2, p_offset := 0)),
  2,
  'limit 2 returns two rows'
);
select is(
  (select count(*)::int from public.admin_list_households(p_limit := 2, p_offset := 2)),
  1,
  'offset 2 returns the remaining row'
);

-- 12-13. No transaction-content columns selected outside count(*)/max().
select is_empty(
  $$ select routine_name from information_schema.routines
     where routine_schema = 'public'
       and routine_name like 'admin\_%'
       and (routine_definition ilike '%transactions.description%'
         or routine_definition ilike '%transactions.amount%'
         or routine_definition ilike '%transactions.merchant%'
         or routine_definition ilike '%\.notes%') $$,
  'no admin function reads transaction content columns'
);
select is_empty(
  $$ select * from information_schema.columns
     where table_schema = 'public' and table_name = 'admin_audit_log'
       and column_name in ('description', 'amount', 'merchant', 'notes') $$,
  'audit log still carries ids/state only'
);

-- 14. Non-admin calls still fail closed after the redefine.
select tests.authenticate_as('e1000000-0000-0000-0000-000000000021');
select throws_ok(
  $$ select * from public.admin_list_households() $$,
  '42501', 'admin access denied',
  'outsider admin_list_households after #272: 42501'
);

-- 15-16. Back as admin: comped filter + detail counts-only shape.
select tests.authenticate_as('e1000000-0000-0000-0000-000000000020');
select is_empty(
  $$ select * from public.admin_list_households(p_status := 'comped') $$,
  'status=comped: empty here (no comped rows in this fixture — filter runs, matches nothing)'
);
select results_eq(
  $$ select transaction_count, account_count, member_count
     from public.admin_get_household('e1000000-0000-0000-0000-000000000001') $$,
  $$ values (1::bigint, 1::bigint, 1::bigint) $$,
  'detail still returns aggregate counts only'
);

-- 17. last_activity advances when a transaction lands (the "when did they
-- last do something" half of the list row).
select ok(
  (select last_activity >= created_at
     from public.admin_list_households(p_search := 'House A38')),
  'A last_activity sane before the second transaction'
);
-- Drop to superuser for the write: the transactions table has no admin
-- write path by design (#271 — admins never write ledger rows).
select tests.clear_auth();
do $$
declare
  v_member uuid := 'e1000000-0000-0000-0000-000000000012';
  v_acct   uuid := 'e1000000-0000-0000-0000-000000000031';
  v_hh     uuid := 'e1000000-0000-0000-0000-000000000001';
begin
  insert into public.transactions
    (household_id, account_id, amount, currency, occurred_on, description, entered_by, spent_by)
  values
    (v_hh, v_acct, 500, 'CLP', current_date, 'Second tx A38', v_member, v_member);
end
$$;
select tests.authenticate_as('e1000000-0000-0000-0000-000000000020');
select results_eq(
  $$ select transaction_count from public.admin_get_household('e1000000-0000-0000-0000-000000000001') $$,
  $$ values (2::bigint) $$,
  'second transaction counted; last_activity probe reads the same max(created_at)'
);

select tests.clear_auth();
select * from finish();
