-- Issue #273 PR #302 review follow-ups: comped moves normalize to active,
-- idempotency keys serialize, extends cannot shorten a window.
--
--   - change_plan onto comped from past_due/grace/trialing/cancelled lands
--     on active with cleared windows (previously: check-constraint
--     violation for past_due/grace, misleading statuses otherwise)
--   - extend_trial/extend_grace reject a future p_extend_to before the
--     current window end; equality still replays idempotently
--   - keyed redelivery replays the stored outcome (sequential proof here;
--     true concurrency cannot run inside one pgTAP transaction — the
--     advisory xact lock in the migration is what serializes it, and the
--     replay path it guards is what these tests pin)
--
-- Audit assertions read as superuser (clear_auth): admin_audit_log carries
-- no authenticated policies by design (see test 39 header).

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_pd      uuid := 'f2000000-0000-0000-0000-000000000001';
  hh_tr      uuid := 'f2000000-0000-0000-0000-000000000002';
  hh_ca      uuid := 'f2000000-0000-0000-0000-000000000003';
  hh_tr2     uuid := 'f2000000-0000-0000-0000-000000000004';
  hh_gr2     uuid := 'f2000000-0000-0000-0000-000000000005';
  hh_key     uuid := 'f2000000-0000-0000-0000-000000000006';
  admin_user uuid := 'f2000000-0000-0000-0000-000000000020';
  outsider   uuid := 'f2000000-0000-0000-0000-000000000021';
begin
  insert into auth.users (id, email) values
    (admin_user, 'admin40@test.local'),
    (outsider, 'outsider40@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_pd, 'PastDue 40', 'NI', 'NIO', 'America/Managua'),
    (hh_tr, 'Trial 40', 'NI', 'NIO', 'America/Managua'),
    (hh_ca, 'Cancelled 40', 'CL', 'CLP', 'America/Santiago'),
    (hh_tr2, 'Trial2 40', 'NI', 'NIO', 'America/Managua'),
    (hh_gr2, 'Grace2 40', 'NI', 'NIO', 'America/Managua'),
    (hh_key, 'Keyed 40', 'CL', 'CLP', 'America/Santiago');

  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end, grace_ends_at) values
    (hh_pd, 'plus', 'stub', 'past_due', now() - interval '2 days', now() + interval '5 days');
  insert into public.subscriptions (household_id, plan_code, provider, status, trial_ends_at, current_period_end) values
    (hh_tr, 'plus', 'stub', 'trialing', now() + interval '7 days', now() + interval '7 days');
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end) values
    (hh_ca, 'plus', 'stub', 'cancelled', now() + interval '10 days');
  insert into public.subscriptions (household_id, plan_code, provider, status, trial_ends_at, current_period_end) values
    (hh_tr2, 'plus', 'stub', 'trialing', now() + interval '14 days', now() + interval '14 days');
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end, grace_ends_at) values
    (hh_gr2, 'plus', 'stub', 'past_due', now() - interval '2 days', now() + interval '5 days');
  insert into public.subscriptions (household_id, plan_code, provider, status, trial_ends_at, current_period_end) values
    (hh_key, 'plus', 'stub', 'trialing', now() + interval '14 days', now() + interval '14 days');

  insert into public.admin_users (user_id, role, note) values
    (admin_user, 'billing', 'test admin 40');
end
$$;

select plan(13);

select tests.authenticate_as('f2000000-0000-0000-0000-000000000020');

-- 1. past_due -> comped lands on active with cleared windows (was: 23514
-- check-constraint violation from dunning_needs_grace_end).
select results_eq(
  $$ select plan_code, status, trial_ends_at, current_period_end, grace_ends_at
      from public.admin_override_subscription(
        'f2000000-0000-0000-0000-000000000001', 'change_plan', 'comped', null,
        'comped rescue, ticket 40-1') $$,
  $$ values ('comped'::text, 'active'::text, null::timestamptz, null::timestamptz, null::timestamptz) $$,
  'change_plan past_due -> comped normalizes to active with cleared windows'
);

-- 2. The audit pins the before/after of that normalization.
select tests.clear_auth();
select results_eq(
  $$ select before_state->>'status', after_state->>'status', after_state->>'plan_code'
      from public.admin_audit_log
     where target_household = 'f2000000-0000-0000-0000-000000000001'
       and action = 'subscription.change_plan' $$,
  $$ values ('past_due'::text, 'active'::text, 'comped'::text) $$,
  'comped-move audit captures past_due -> active'
);
select tests.authenticate_as('f2000000-0000-0000-0000-000000000020');

-- 3-4. trialing and cancelled rows normalize the same way (no misleading
-- perpetual-trialing or perpetual-cancelled rows for the next operator).
select results_eq(
  $$ select plan_code, status from public.admin_override_subscription(
        'f2000000-0000-0000-0000-000000000002', 'change_plan', 'comped', null, 'ticket 40-2') $$,
  $$ values ('comped'::text, 'active'::text) $$,
  'change_plan trialing -> comped normalizes to active'
);
select results_eq(
  $$ select plan_code, status from public.admin_override_subscription(
        'f2000000-0000-0000-0000-000000000003', 'change_plan', 'comped', null, 'ticket 40-3') $$,
  $$ values ('comped'::text, 'active'::text) $$,
  'change_plan cancelled -> comped normalizes to active'
);

-- 5. extend_trial rejects a future date before the current trial end:
-- shrinking entitlement is revoke's job, with confirmation.
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f2000000-0000-0000-0000-000000000004', 'extend_trial', null,
        now() + interval '7 days', 'shorten 40') $$,
  '23514', 'extend_trial needs a p_extend_to on or after the current trial end',
  'extend_trial that shortens the window: 23514'
);

-- 6. Widening applies, and re-passing the exact stored end replays
-- idempotently (equality is not a shorten). The inner call widens to +30d
-- and returns its stored trial_ends_at; the outer call replays that exact
-- value — no psql variables needed (they do not interpolate inside
-- dollar-quoting).
select results_eq(
  $$ select status, was_idempotent from public.admin_override_subscription(
        'f2000000-0000-0000-0000-000000000004', 'extend_trial', null,
        (select trial_ends_at from public.admin_override_subscription(
           'f2000000-0000-0000-0000-000000000004', 'extend_trial', null,
           now() + interval '30 days', 'widen 40')),
        'equality replay 40') $$,
  $$ values ('trialing'::text, true) $$,
  'extend_trial equality with the current end is an idempotent replay'
);

-- 8. extend_grace rejects a future date before the current grace end.
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f2000000-0000-0000-0000-000000000005', 'extend_grace', null,
        now() + interval '2 days', 'shorten grace 40') $$,
  '23514', 'extend_grace needs a p_extend_to on or after the current grace end',
  'extend_grace that shortens the window: 23514'
);

-- 9. Widening the grace window still applies.
select lives_ok(
  $$ select * from public.admin_override_subscription(
        'f2000000-0000-0000-0000-000000000005', 'extend_grace', null,
        now() + interval '30 days', 'widen grace 40') $$,
  'extend_grace widening applies'
);

-- 10-11. Keyed extend: first call applies, same-key redelivery replays the
-- stored outcome (the advisory lock in the migration is what makes this
-- safe under real concurrency; the replay path is pinned here).
select results_eq(
  $$ select status, was_idempotent from public.admin_override_subscription(
        'f2000000-0000-0000-0000-000000000006', 'extend_trial', null,
        now() + interval '20 days', 'keyed extend 40', false, 'key-40-1') $$,
  $$ values ('trialing'::text, false) $$,
  'first keyed extend applies'
);
select results_eq(
  $$ select status, was_idempotent from public.admin_override_subscription(
        'f2000000-0000-0000-0000-000000000006', 'extend_trial', null,
        now() + interval '20 days', 'keyed extend 40', false, 'key-40-1') $$,
  $$ values ('trialing'::text, true) $$,
  'same-key redelivery replays as idempotent'
);

-- 12. One key, one audit row: the replay wrote nothing new.
select tests.clear_auth();
select is(
  (select count(*)::int from public.admin_audit_log
    where target_household = 'f2000000-0000-0000-0000-000000000006'
      and idempotency_key = 'key-40-1'),
  1,
  'keyed replay writes no second audit row'
);

-- 13. The redefined function still has no contact with transaction contents.
select is_empty(
  $$ select routine_name from information_schema.routines
      where routine_schema = 'public'
        and routine_name = 'admin_override_subscription'
        and (routine_definition ilike '%transactions%'
          or routine_definition ilike '%description%'
          or routine_definition ilike '%amount%') $$,
  'override function still never reads transaction contents'
);

-- 14. Non-admin calls still fail closed after the redefine.
select tests.authenticate_as('f2000000-0000-0000-0000-000000000021');
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f2000000-0000-0000-0000-000000000001', 'grant_comped', null, null, 'outsider 40') $$,
  '42501', 'admin access denied',
  'outsider override after redefine: 42501'
);

select tests.clear_auth();
select * from finish();
