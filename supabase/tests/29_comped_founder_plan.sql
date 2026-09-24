-- Comped founder plan (#263): hidden full-entitlement plan, backfill of
-- subscription-less households, and the comped signup default while billing
-- is disabled. Sweeper immunity for the JS expiry job is asserted in
-- src/lib/billing/lifecycle-io.test.ts (clock advanced a year); here pgTAP
-- proves the DB half (infinity resolution, listing exclusion, grants).
--
-- Households under test (29* namespace, unique to this file):
-- - hh_comped  (comped/active, no dates — the steady state)
-- - hh_nosub   (no subscription — backfill target)
-- - hh_expired (expired-only row — backfill target, lapsed population)
-- - hh_stale   (cancelled past its period end — time-ended but unflipped:
--   blocks the backfill via the one-live index while resolving to NULL)
-- - hh_free    (live free/active — must NOT be double-filled)

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  u_comped  uuid := '29111111-1111-1111-1111-111111111111';
  u_nosub   uuid := '29222222-2222-2222-2222-222222222222';
  u_expired uuid := '29333333-3333-3333-3333-333333333333';
  u_free    uuid := '29444444-4444-4444-4444-444444444444';
  u_signup  uuid := '29555555-5555-5555-5555-555555555555';
  u_stale   uuid := '29666666-6666-6666-6666-666666666666';
  hh_comped  uuid := '29000000-0000-0000-0000-000000000001';
  hh_nosub   uuid := '29000000-0000-0000-0000-000000000002';
  hh_expired uuid := '29000000-0000-0000-0000-000000000003';
  hh_free    uuid := '29000000-0000-0000-0000-000000000004';
  hh_stale   uuid := '29000000-0000-0000-0000-000000000005';
begin
  insert into auth.users (id, email) values
    (u_comped,  'comped29@test.local'),
    (u_nosub,   'nosub29@test.local'),
    (u_expired, 'expired29@test.local'),
    (u_free,    'free29@test.local'),
    (u_signup,  'signup29@test.local'),
    (u_stale,   'stale29@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_comped,  'T29 Comped',  'CL', 'CLP', 'America/Santiago'),
    (hh_nosub,   'T29 NoSub',   'CL', 'CLP', 'America/Santiago'),
    (hh_expired, 'T29 Expired', 'CL', 'CLP', 'America/Santiago'),
    (hh_free,    'T29 Free',    'CL', 'CLP', 'America/Santiago'),
    (hh_stale,   'T29 Stale',   'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_comped,  u_comped,  'owner', 'Comped'),
    (hh_nosub,   u_nosub,   'owner', 'NoSub'),
    (hh_expired, u_expired, 'owner', 'Expired'),
    (hh_free,    u_free,    'owner', 'Free'),
    (hh_stale,   u_stale,   'owner', 'Stale');
  -- u_signup owns nothing yet; create_household() adds its membership.

  -- Steady state: perpetual comped row (no dates -> infinity).
  insert into public.subscriptions (household_id, plan_code, provider, status) values
    (hh_comped, 'comped', 'stub', 'active');

  -- Lapsed population: expired-only row (no live subscription).
  insert into public.subscriptions
    (household_id, plan_code, provider, status, current_period_end) values
    (hh_expired, 'free', 'stub', 'expired', now() - interval '5 days');

  -- Time-ended but unflipped: live-status row that resolves to NULL.
  insert into public.subscriptions
    (household_id, plan_code, provider, status, current_period_end, cancel_at_period_end) values
    (hh_stale, 'plus', 'stub', 'cancelled', now() - interval '5 days', true);

  -- Live free row: backfill must leave it alone (one-live index).
  insert into public.subscriptions
    (household_id, plan_code, provider, status, current_period_end) values
    (hh_free, 'free', 'stub', 'active', now() + interval '30 days');

  -- hh_nosub deliberately has no subscription row (pre-#261 population).

  -- Exercise the migration's repair (2a) then backfill (2b) verbatim:
  -- time-ended rows flip to expired first so they cannot squat the
  -- one-live slot while resolving to NULL; then households with no live
  -- subscription gain comped and live rows are untouched.
  update public.subscriptions
     set status = 'expired'
   where household_id in (hh_nosub, hh_expired, hh_stale, hh_free, hh_comped)
     and ((status in ('past_due', 'grace') and grace_ends_at <= now())
      or (status = 'cancelled'
          and (current_period_end is null or current_period_end <= now()))
      or (status = 'trialing'
          and trial_ends_at is not null and trial_ends_at <= now()));

  insert into public.subscriptions (household_id, plan_code, provider, status)
  select h.id, 'comped', 'stub', 'active'
    from public.households h
   where h.id in (hh_nosub, hh_expired, hh_stale, hh_free, hh_comped)
     and not exists (
       select 1 from public.subscriptions s
        where s.household_id = h.id
          and s.status in ('trialing', 'active', 'past_due', 'grace', 'cancelled')
     );
end
$$;

select plan(17);

-- ============================================================================
-- A. Catalogue: comped exists, hidden, fully entitled.
-- ============================================================================

select tests.authenticate_as('29111111-1111-1111-1111-111111111111', 'comped29@test.local');

select is(
  (select is_public from public.plans where code = 'comped'),
  false,
  'comped plan is not public'
);

select results_eq(
  $$ select code from public.plans where is_public order by sort_order $$,
  $$ values ('free'::text), ('plus'::text) $$,
  'comped does not appear in the public plan listing'
);

select is(
  public.household_plan('29000000-0000-0000-0000-000000000001'::uuid),
  'comped'::text,
  'household_plan returns comped for the dateless active row'
);

select results_eq(
  $$ select current_period_end, grace_ends_at from public.subscriptions
      where household_id = '29000000-0000-0000-0000-000000000001'::uuid
        and status = 'active' $$,
  $$ values (null::timestamptz, null::timestamptz) $$,
  'comped subscription carries no period end (resolves through infinity)'
);

select is(
  public.has_feature('29000000-0000-0000-0000-000000000001'::uuid, 'write_access'),
  true,
  'comped carries write_access so #261 policies pass'
);

select is(
  public.feature_limit('29000000-0000-0000-0000-000000000001'::uuid, 'accounts'),
  2147483647,
  'comped accounts limit is unlimited (NULL sentinel)'
);

select is(
  public.has_feature('29000000-0000-0000-0000-000000000001'::uuid, 'export'),
  true,
  'comped carries export (full plus vocabulary)'
);

select is(
  public.can_write('29000000-0000-0000-0000-000000000001'::uuid),
  true,
  'can_write is true for the comped household'
);

-- ============================================================================
-- B. Backfill: nosub + expired + time-ended-unflipped gain comped; live
-- rows untouched.
-- (As superuser: these assert DB state, not access control — each
-- household's own member is covered by the RLS matrix in 02/07.)
-- ============================================================================

select tests.clear_auth();

select results_eq(
  $$ select s.plan_code || '/' || s.status from public.subscriptions s
      where s.household_id = '29000000-0000-0000-0000-000000000002'::uuid
        and s.status <> 'expired' $$,
  $$ values ('comped/active'::text) $$,
  'backfill: subscription-less household gains comped/active'
);

select results_eq(
  $$ select s.plan_code || '/' || s.status from public.subscriptions s
      where s.household_id = '29000000-0000-0000-0000-000000000003'::uuid
        and s.status <> 'expired' $$,
  $$ values ('comped/active'::text) $$,
  'backfill: expired-only household gains comped/active'
);

select results_eq(
  $$ select s.plan_code || '/' || s.status from public.subscriptions s
      where s.household_id = '29000000-0000-0000-0000-000000000005'::uuid
        and s.status <> 'expired'
      order by 1 $$,
  $$ values ('comped/active'::text) $$,
  'backfill: time-ended cancelled row flips to expired, household gains comped/active'
);

select results_eq(
  $$ select s.plan_code || '/' || s.status from public.subscriptions s
      where s.household_id = '29000000-0000-0000-0000-000000000005'::uuid
        and s.status = 'expired' $$,
  $$ values ('plus/expired'::text) $$,
  'repair: stale live-status row is expired, freeing the one-live slot'
);

select results_eq(
  $$ select s.plan_code || '/' || s.status from public.subscriptions s
      where s.household_id = '29000000-0000-0000-0000-000000000004'::uuid
        and s.status <> 'expired' $$,
  $$ values ('free/active'::text) $$,
  'backfill: household with a live row keeps it (no second live row)'
);

select is(
  public.household_plan('29000000-0000-0000-0000-000000000002'::uuid),
  'comped'::text,
  'backfilled household resolves to comped'
);

-- ============================================================================
-- C. Signup default while billing is disabled: create_household grants
-- comped/active before the default-account insert trips the trigger.
-- ============================================================================

select tests.authenticate_as('29555555-5555-5555-5555-555555555555', 'signup29@test.local');

select lives_ok(
  $$ select public.create_household('T29 Signup', 'CL', 'CLP', 'Signup Owner') $$,
  'signup: create_household succeeds with enforcement live'
);

select tests.clear_auth();

select results_eq(
  $$ select s.plan_code || '/' || s.status from public.subscriptions s
     join public.households h on h.id = s.household_id
     where h.name = 'T29 Signup' $$,
  $$ values ('comped/active'::text) $$,
  'signup: new household holds a live comped subscription'
);

select tests.authenticate_as('29555555-5555-5555-5555-555555555555', 'signup29@test.local');

select is(
  public.can_write((select id from public.households where name = 'T29 Signup')),
  true,
  'signup: new household can write immediately'
);

select tests.clear_auth();
select * from finish();
