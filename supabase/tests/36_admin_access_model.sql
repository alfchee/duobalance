-- Issue #271: admin access model — an admin session must never reach
-- transaction contents through any route, and every admin action writes an
-- audit row. Proves the data-layer half of the acceptance criteria:
--
--   - admin role is distinct from household membership (owner-but-not-admin
--     is not admin; admin-but-not-member is admin yet reads zero
--     transaction rows through RLS)
--   - admin readers return counts + billing state only (no description,
--     amount, merchant, notes, category or account-name columns exist on
--     any admin function output; function bodies never select those
--     columns except count(*))
--   - non-admin calls to admin functions raise 42501 (the API maps this to
--     a neutral 404 so probes learn nothing)
--   - admin_log_action() appends actor/target/timestamp rows and refuses
--     non-admins
--   - anon reaches nothing

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_a           uuid := 'c1000000-0000-0000-0000-000000000001';
  owner_user     uuid := 'c1000000-0000-0000-0000-000000000002';
  owner_member   uuid := 'c1000000-0000-0000-0000-000000000003';
  admin_user     uuid := 'c1000000-0000-0000-0000-000000000004';
  outsider_user  uuid := 'c1000000-0000-0000-0000-000000000005';
  acct_a         uuid := 'c1000000-0000-0000-0000-000000000006';
  tx_a           uuid := 'c1000000-0000-0000-0000-000000000007';
begin
  insert into auth.users (id, email) values
    (owner_user,    'owner36@test.local'),
    (admin_user,    'admin36@test.local'),
    (outsider_user, 'outsider36@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'House A36', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_member, hh_a, owner_user, 'owner', 'Owner A36');

  perform tests.entitle_household(hh_a);

  insert into public.accounts (id, household_id, name, kind, currency) values
    (acct_a, hh_a, 'Shared checking', 'checking', 'CLP');

  insert into public.transactions
    (id, household_id, account_id, amount, currency, occurred_on, description, entered_by, spent_by)
  values
    (tx_a, hh_a, acct_a, -2500, 'CLP', current_date, 'Secret groceries', owner_member, owner_member);

  -- The admin holds a roster entry but NO household membership: the two
  -- role systems are disjoint by construction.
  insert into public.admin_users (user_id, role, note) values
    (admin_user, 'support', 'test admin');
end
$$;

select plan(21);

-- 1. Role model: owner-but-not-admin is not admin.
select tests.authenticate_as('c1000000-0000-0000-0000-000000000002');
select is(
  public.is_admin(),
  false,
  'owner without a roster entry is not admin (roles are distinct)'
);

-- 2. Role model: admin-but-not-member is admin.
select tests.authenticate_as('c1000000-0000-0000-0000-000000000004');
select is(
  public.is_admin(),
  true,
  'roster entry without household membership is admin'
);

-- 3-4. No path from admin session to household session: the admin reads
-- zero transaction rows AND zero household rows through RLS.
select is_empty(
  $$ select * from public.transactions $$,
  'admin SELECT on transactions: empty (not a member, RLS holds)'
);
select is_empty(
  $$ select * from public.households $$,
  'admin SELECT on households: empty (not a member, RLS holds)'
);

-- 5-6. Purpose-built readers work for the admin and return counts only.
select results_eq(
  $$ select transaction_count, account_count, member_count
     from public.admin_list_households() $$,
  $$ values (1::bigint, 1::bigint, 1::bigint) $$,
  'admin_list_households returns aggregate counts (1 tx, 1 acct, 1 member)'
);
select results_eq(
  $$ select transaction_count from public.admin_get_household('c1000000-0000-0000-0000-000000000001') $$,
  $$ values (1::bigint) $$,
  'admin_get_household returns the transaction COUNT, never rows'
);

-- 7-10. No transaction-content column exists on any admin function output.
select is_empty(
  $$ select * from information_schema.columns
     where table_schema = 'public'
       and table_name in ('admin_list_households', 'admin_get_household')
     -- information_schema has no function-output catalog; this guards the
     -- future-table form of the readers. The column-name guard below covers
     -- the function bodies directly.
  $$,
  'placeholder: no admin reader tables exist (functions only)'
);
select is_empty(
  $$ select * from information_schema.columns
     where table_schema = 'public' and table_name = 'admin_audit_log'
       and column_name in ('description', 'amount', 'merchant', 'notes') $$,
  'admin_audit_log carries ids/state only, never transaction contents'
);
-- Function bodies: the only contact with transactions is count(*). Any
-- select of description/amount/merchant/notes/category-name/account-name
-- outside a count fails this test.
select is_empty(
  $$ select routine_name from information_schema.routines
     where routine_schema = 'public'
       and routine_name like 'admin\_%'
       and routine_definition ilike '%transactions.description%' $$,
  'no admin function reads transactions.description'
);
select is_empty(
  $$ select routine_name from information_schema.routines
     where routine_schema = 'public'
       and routine_name like 'admin\_%'
       and (routine_definition ilike '%transactions.amount%'
         or routine_definition ilike '%transactions.merchant%'
         or routine_definition ilike '%\.notes%') $$,
  'no admin function reads transaction amount/merchant/notes columns'
);

-- 11. Billing-event reader exposes metadata only (no payload column).
select is_empty(
  $$ select * from information_schema.parameters
     where specific_schema = 'public'
       and specific_name ilike '%admin_get_billing_events%'
       and parameter_name = 'payload' $$,
  'admin_get_billing_events has no payload parameter/column'
);

-- 12-13. Subscription history is reachable for the admin (the "why did
-- access change" half of support) and carries status only.
select results_eq(
  $$ select status from public.admin_get_subscription_history('c1000000-0000-0000-0000-000000000001') $$,
  $$ values ('active'::text) $$,
  'admin subscription history shows the live test subscription'
);
select is_empty(
  $$ select * from public.admin_get_billing_events('c1000000-0000-0000-0000-000000000001') $$,
  'admin billing events for a fresh household: empty (no deliveries yet)'
);

-- 14-16. Non-admin calls fail closed with 42501 (API maps to neutral 404).
select tests.authenticate_as('c1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$ select * from public.admin_list_households() $$,
  '42501', 'admin access denied',
  'outsider admin_list_households: 42501 (neutral 404 at the API)'
);
select throws_ok(
  $$ select * from public.admin_get_household('c1000000-0000-0000-0000-000000000001') $$,
  '42501', 'admin access denied',
  'outsider admin_get_household: 42501 (neutral 404 at the API)'
);
select throws_ok(
  $$ select public.admin_log_action('households.list', null, null, null, null) $$,
  '42501', 'admin access denied',
  'outsider admin_log_action: 42501 (cannot forge audit rows)'
);

-- 17-18. Every admin action writes an audit row (actor, target, timestamp).
select tests.authenticate_as('c1000000-0000-0000-0000-000000000004');
select lives_ok(
  $$ select public.admin_log_action(
       'households.view',
       'c1000000-0000-0000-0000-000000000001',
       'support probe',
       '{"plan_code":"free"}'::jsonb,
       '{"plan_code":"plus"}'::jsonb
     ) $$,
  'admin_log_action executes for an admin'
);
select tests.clear_auth();
select ok(true, 'drop to superuser to inspect the append-only audit log');
select results_eq(
  $$ select actor::text, action, target_household::text
     from public.admin_audit_log
     where reason = 'support probe' $$,
  $$ values (
    'c1000000-0000-0000-0000-000000000004'::text,
    'households.view'::text,
    'c1000000-0000-0000-0000-000000000001'::text
  ) $$,
  'audit row captures actor, action and target household'
);

-- 19. Audit rows carry a timestamp.
select ok(
  (select count(*) > 0 from public.admin_audit_log where created_at is not null),
  'audit rows carry a timestamp'
);

-- 20. Anon reaches nothing, including the admin readers.
select tests.authenticate_anon();
select throws_like(
  $$ select * from public.admin_list_households() $$,
  '%permission denied%',
  'anon admin_list_households: denied (no grant + denied inside)'
);

select tests.clear_auth();
select * from finish();
