-- Billing lifecycle end-to-end at the database layer (#266): a downgraded
-- household loses entitlement and its writes are refused by RLS (not just
-- hidden in the UI), while a comped household survives a simulated go-live
-- with full write access. The TypeScript half of this story — stub plus
-- ledger walking every lifecycle state — lives in src/lib/billing/e2e/.
--
-- Households under test (30* namespace, unique to this file):
-- - hh_down   (plus/active member; downgraded mid-file to expired-only)
-- - hh_comp   (comped/active, no dates — the go-live survivor)

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  u_down  uuid := '30111111-1111-1111-1111-111111111111';
  u_comp  uuid := '30222222-2222-2222-2222-222222222222';
  hh_down uuid := '30000000-0000-0000-0000-000000000001';
  hh_comp uuid := '30000000-0000-0000-0000-000000000002';
begin
  insert into auth.users (id, email) values
    (u_down, 'down30@test.local'),
    (u_comp, 'comp30@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_down, 'T30 Downgrade', 'CL', 'CLP', 'America/Santiago'),
    (hh_comp, 'T30 Comped',    'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_down, u_down, 'owner', 'Down'),
    (hh_comp, u_comp, 'owner', 'Comp');

  -- Live rows: plus with a period end, comped dateless (sweeper-immune).
  insert into public.subscriptions
    (household_id, plan_code, provider, status, current_period_end) values
    (hh_down, 'plus', 'stub', 'active', now() + interval '30 days');
  insert into public.subscriptions
    (household_id, plan_code, provider, status) values
    (hh_comp, 'comped', 'stub', 'active');
end
$$;

select plan(11);

-- ============================================================================
-- A. Entitled baseline: the plus member writes before the downgrade.
-- ============================================================================

select tests.authenticate_as('30111111-1111-1111-1111-111111111111', 'down30@test.local');

select lives_ok(
  $$ insert into public.accounts
       (id, household_id, name, kind, currency) values
       ('30000000-0000-0000-0000-000000000011',
        '30000000-0000-0000-0000-000000000001'::uuid,
        'Downgrade Checking', 'checking', 'CLP') $$,
  'downgrade: entitled member inserts an account before the downgrade'
);

-- ============================================================================
-- B. Downgrade: the subscription lapses (post-cancel sweep), entitlement is
-- gone, and writes are refused at the database layer.
-- ============================================================================

select tests.clear_auth();

-- Simulate the period end passing on a cancelled subscription: the sweeper
-- flips it to expired with no live period left.
update public.subscriptions
   set status = 'expired',
       current_period_end = now() - interval '1 day',
       grace_ends_at = null
 where household_id = '30000000-0000-0000-0000-000000000001'::uuid;

select tests.authenticate_as('30111111-1111-1111-1111-111111111111', 'down30@test.local');

select is(
  public.household_plan('30000000-0000-0000-0000-000000000001'::uuid),
  null::text,
  'downgrade: expired-only household resolves to no plan'
);

select is(
  public.has_feature('30000000-0000-0000-0000-000000000001'::uuid, 'write_access'),
  false,
  'downgrade: write_access is gone'
);

select is(
  public.can_write('30000000-0000-0000-0000-000000000001'::uuid),
  false,
  'downgrade: can_write is false'
);

select throws_ok(
  $$ insert into public.accounts (household_id, name, kind, currency)
     values ('30000000-0000-0000-0000-000000000001'::uuid,
             'Sneak', 'checking', 'CLP') $$,
  'P0001', null,
  'downgrade: INSERT into accounts refused at the database layer (fail-closed limit trigger)'
);

select results_eq(
  $$ with updated as (
       update public.accounts set name = 'pwned'
        where id = '30000000-0000-0000-0000-000000000011'::uuid
        returning 1
     )
     select count(*)::int from updated $$,
  $$ values (0::int) $$,
  'downgrade: UPDATE on accounts affects 0 rows (USING blocks)'
);

-- ============================================================================
-- C. Simulated go-live: the comped household keeps full access while the
-- flag is conceptually on — no lapse, no refusal.
-- ============================================================================

select tests.authenticate_as('30222222-2222-2222-2222-222222222222', 'comp30@test.local');

select is(
  public.has_feature('30000000-0000-0000-0000-000000000002'::uuid, 'write_access'),
  true,
  'go-live: comped household keeps write_access'
);

select is(
  public.can_write('30000000-0000-0000-0000-000000000002'::uuid),
  true,
  'go-live: comped household can write'
);

select lives_ok(
  $$ insert into public.accounts
       (id, household_id, name, kind, currency) values
       ('30000000-0000-0000-0000-000000000012',
        '30000000-0000-0000-0000-000000000002'::uuid,
        'Comped Checking', 'checking', 'CLP') $$,
  'go-live: comped member inserts an account'
);

select results_eq(
  $$ with updated as (
       update public.accounts set name = 'Comped Checking (renamed)'
        where id = '30000000-0000-0000-0000-000000000012'::uuid
        returning 1
     )
     select count(*)::int from updated $$,
  $$ values (1::int) $$,
  'go-live: comped member UPDATE affects 1 row'
);

select tests.clear_auth();

select results_eq(
  $$ select s.plan_code || '/' || s.status,
           s.current_period_end is null and s.grace_ends_at is null
       from public.subscriptions s
      where s.household_id = '30000000-0000-0000-0000-000000000002'::uuid $$,
  $$ values ('comped/active'::text, true) $$,
  'go-live: comped row stays active with no dates (sweeper-immune shape)'
);

select * from finish();
