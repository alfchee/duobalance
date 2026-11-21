-- Plans/entitlements (#257): fail-closed helpers, seed from ADR 0001, RLS
-- tenant isolation, and every constraint the issue lists. The nested
-- coalesce in feature_limit() is load-bearing: NULL limit = explicitly
-- unlimited (sentinel), missing row = zero. Tests prove both separately.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  usr_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  usr_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  hh_nosub    uuid := '10000000-0000-0000-0000-000000000001';
  hh_trial    uuid := '10000000-0000-0000-0000-000000000002';
  hh_active   uuid := '10000000-0000-0000-0000-000000000003';
  hh_pastdue  uuid := '10000000-0000-0000-0000-000000000004';
  hh_grace    uuid := '10000000-0000-0000-0000-000000000005';
  hh_cancel   uuid := '10000000-0000-0000-0000-000000000006';
  hh_expired  uuid := '10000000-0000-0000-0000-000000000007';
  hh_dup      uuid := '10000000-0000-0000-0000-000000000008';
  hh_check    uuid := '10000000-0000-0000-0000-000000000009';
  hh_trialpast uuid := '10000000-0000-0000-0000-000000000010';
begin
  insert into auth.users (id, email) values
    (usr_a, 'alice@test.local'),
    (usr_b, 'bob@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_nosub,   'No Sub',   'CL', 'CLP', 'America/Santiago'),
    (hh_trial,   'Trial',    'CL', 'CLP', 'America/Santiago'),
    (hh_active,  'Active',   'CL', 'CLP', 'America/Santiago'),
    (hh_pastdue, 'Past Due', 'CL', 'CLP', 'America/Santiago'),
    (hh_grace,   'Grace',    'CL', 'CLP', 'America/Santiago'),
    (hh_cancel,  'Cancel',   'CL', 'CLP', 'America/Santiago'),
    (hh_expired, 'Expired',  'CL', 'CLP', 'America/Santiago'),
    (hh_dup,     'Dup',      'CL', 'CLP', 'America/Santiago'),
    (hh_check,   'Check',    'CL', 'CLP', 'America/Santiago'),
    (hh_trialpast, 'Trial Past', 'CL', 'CLP', 'America/Santiago');

  -- Alice owns the plus household, Bob the free trial household
  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_active, usr_a, 'owner', 'Alice'),
    (hh_trial,  usr_b, 'owner', 'Bob');

  -- One subscription per status under test (each on its own household so the
  -- one-live-subscription index never interferes with the plan assertions)
  insert into public.subscriptions (household_id, plan_code, provider, status, trial_ends_at) values
    (hh_trial, 'free', 'stub', 'trialing', now() + interval '30 days');
  -- trialing with trial_ends_at already past and no period/grace ends:
  -- status is the source of truth until the dunning writer exists, so this
  -- stays entitled (falls through to 'infinity'). Locks in the contract.
  insert into public.subscriptions (household_id, plan_code, provider, status, trial_ends_at) values
    (hh_trialpast, 'free', 'stub', 'trialing', now() - interval '5 days');
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end) values
    (hh_active, 'plus', 'stub', 'active', now() + interval '30 days');
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end, grace_ends_at) values
    (hh_pastdue, 'plus', 'stub', 'past_due', now() - interval '5 days', now() + interval '9 days'),
    (hh_grace,   'plus', 'stub', 'grace',    now() - interval '5 days', now() + interval '9 days');
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end, cancel_at_period_end) values
    (hh_cancel, 'plus', 'stub', 'cancelled', now() + interval '20 days', true);
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end) values
    (hh_expired, 'free', 'stub', 'expired', now() - interval '5 days');
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end) values
    (hh_dup, 'free', 'stub', 'active', now() + interval '30 days');

  insert into public.billing_events (provider, provider_event_id, type, payload) values
    ('stub', 'evt-seed-1', 'test.ping', '{"seed":true}'::jsonb);
end
$$;

select plan(26);

-- AC: no subscription row -> false / 0 (fail closed)
select is(
  public.has_feature('10000000-0000-0000-0000-000000000001'::uuid, 'export'),
  false,
  'has_feature: household with no subscription returns false'
);

select is(
  public.feature_limit('10000000-0000-0000-0000-000000000001'::uuid, 'accounts'),
  0,
  'feature_limit: household with no subscription returns 0'
);

-- AC: NULL limit_value = unlimited sentinel; missing row = 0 (two tests)
select is(
  public.feature_limit('10000000-0000-0000-0000-000000000003'::uuid, 'accounts'),
  2147483647,
  'feature_limit: plus accounts row with NULL limit returns unlimited sentinel'
);

select is(
  public.feature_limit('10000000-0000-0000-0000-000000000003'::uuid, 'definitely_not_a_feature'),
  0,
  'feature_limit: missing feature row returns 0, never unlimited'
);

-- AC: household_plan returns the plan in every entitled status, including
-- past_due/grace whose current_period_end is already past
select is(
  public.household_plan('10000000-0000-0000-0000-000000000002'::uuid),
  'free'::text,
  'household_plan: trialing household resolves to free'
);

select is(
  public.household_plan('10000000-0000-0000-0000-000000000003'::uuid),
  'plus'::text,
  'household_plan: active household resolves to plus'
);

select is(
  public.household_plan('10000000-0000-0000-0000-000000000004'::uuid),
  'plus'::text,
  'household_plan: past_due with past period end but live grace resolves to plus'
);

select is(
  public.household_plan('10000000-0000-0000-0000-000000000005'::uuid),
  'plus'::text,
  'household_plan: grace with past period end resolves to plus'
);

select is(
  public.household_plan('10000000-0000-0000-0000-000000000006'::uuid),
  'plus'::text,
  'household_plan: cancelled with future period end still resolves (cancel at period end)'
);

select is(
  public.household_plan('10000000-0000-0000-0000-000000000007'::uuid),
  null::text,
  'household_plan: expired household resolves to null'
);

select is(
  public.household_plan('10000000-0000-0000-0000-000000000010'::uuid),
  null::text,
  'household_plan: trialing with past trial_ends_at stops resolving (ADR auto-downgrade)'
);

-- AC: second live subscription for one household raises unique violation
select throws_ok(
  $$ insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end)
     values ('10000000-0000-0000-0000-000000000008'::uuid, 'plus', 'stub', 'active', now() + interval '30 days') $$,
  '23505',
  null,
  'second live subscription for one household raises unique violation'
);

-- AC: past_due without grace_ends_at rejected by check constraint
select throws_ok(
  $$ insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end)
     values ('10000000-0000-0000-0000-000000000009'::uuid, 'plus', 'stub', 'past_due', now() + interval '30 days') $$,
  '23514',
  null,
  'past_due without grace_ends_at rejected by dunning_needs_grace_end'
);

-- AC: duplicate (provider, provider_event_id) raises unique violation
select throws_ok(
  $$ insert into public.billing_events (provider, provider_event_id, type, payload)
     values ('stub', 'evt-seed-1', 'test.ping', '{}'::jsonb) $$,
  '23505',
  null,
  'duplicate billing_events (provider, provider_event_id) raises unique violation'
);

-- AC: anon cannot execute any of the three functions
select tests.authenticate_anon();

select throws_ok(
  $$ select public.household_plan('10000000-0000-0000-0000-000000000003'::uuid) $$,
  '42501',
  null,
  'anon cannot execute household_plan'
);

select throws_ok(
  $$ select public.has_feature('10000000-0000-0000-0000-000000000003'::uuid, 'export') $$,
  '42501',
  null,
  'anon cannot execute has_feature'
);

select throws_ok(
  $$ select public.feature_limit('10000000-0000-0000-0000-000000000003'::uuid, 'accounts') $$,
  '42501',
  null,
  'anon cannot execute feature_limit'
);

-- AC: cross-household subscription reads denied
select tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@test.local');

select results_eq(
  $$ select count(*)::int from public.subscriptions $$,
  $$ values (1::int) $$,
  'Alice sees exactly one subscription (her own household)'
);

select is_empty(
  $$ select * from public.subscriptions where household_id = '10000000-0000-0000-0000-000000000002'::uuid $$,
  'Alice cannot see Bob household subscription'
);

-- Helpers are SECURITY INVOKER: probing another household through the RPC
-- path fail-closes exactly like a direct table read (regression test for
-- the DEFINER probing leak)
select is(
  public.household_plan('10000000-0000-0000-0000-000000000002'::uuid),
  null::text,
  'Alice probing Bob household via household_plan gets null'
);

select is(
  public.has_feature('10000000-0000-0000-0000-000000000002'::uuid, 'export'),
  false,
  'Alice probing Bob household via has_feature gets false'
);

select is(
  public.feature_limit('10000000-0000-0000-0000-000000000002'::uuid, 'accounts'),
  0,
  'Alice probing Bob household via feature_limit gets 0'
);

select tests.authenticate_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@test.local');

select results_eq(
  $$ select count(*)::int from public.subscriptions $$,
  $$ values (1::int) $$,
  'Bob sees exactly one subscription (his own household)'
);

-- Seed from ADR 0001 made it into the database (#263 adds comped after plus)
select results_eq(
  $$ select code from public.plans order by sort_order $$,
  $$ values ('free'::text), ('plus'::text), ('comped'::text) $$,
  'plans seed: free, plus and comped in sort order'
);

select is(
  public.feature_limit('10000000-0000-0000-0000-000000000002'::uuid, 'accounts'),
  4,
  'seed: free accounts limit is 4'
);

-- Plus seed check must run as a member of the plus household (INVOKER)
select tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@test.local');

select is(
  public.has_feature('10000000-0000-0000-0000-000000000003'::uuid, 'export'),
  true,
  'seed: plus has export enabled'
);

select tests.clear_auth();
select * from finish();
