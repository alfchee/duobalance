-- Issue #273: admin plan overrides and comp grants — mandatory reason,
-- before/after audit, confirm-to-revoke, one-live respected, idempotent
-- double-click.
--
-- Proves the data-layer half of the acceptance criteria:
--   - no entitlement-changing action without a recorded reason
--   - audit captures before/after state for every change
--   - revoking requires explicit confirmation
--   - the one-live partial index is respected (no second live row)
--   - idempotency-key replay returns the stored outcome with zero state touch
--
-- Convention (from tests 36/37): admin_audit_log has no authenticated
-- policies by design, so audit assertions run as superuser (clear_auth)
-- after performing the action as the admin.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_grant    uuid := 'f1000000-0000-0000-0000-000000000001';
  hh_live     uuid := 'f1000000-0000-0000-0000-000000000002';
  hh_trial    uuid := 'f1000000-0000-0000-0000-000000000003';
  hh_grace    uuid := 'f1000000-0000-0000-0000-000000000004';
  hh_plan     uuid := 'f1000000-0000-0000-0000-000000000005';
  hh_revoke   uuid := 'f1000000-0000-0000-0000-000000000006';
  hh_empty    uuid := 'f1000000-0000-0000-0000-000000000007';
  hh_idem     uuid := 'f1000000-0000-0000-0000-000000000008';
  owner_g     uuid := 'f1000000-0000-0000-0000-000000000011';
  owner_l     uuid := 'f1000000-0000-0000-0000-000000000012';
  owner_t     uuid := 'f1000000-0000-0000-0000-000000000013';
  owner_gr    uuid := 'f1000000-0000-0000-0000-000000000014';
  owner_p     uuid := 'f1000000-0000-0000-0000-000000000015';
  owner_r     uuid := 'f1000000-0000-0000-0000-000000000016';
  owner_e     uuid := 'f1000000-0000-0000-0000-000000000017';
  owner_i     uuid := 'f1000000-0000-0000-0000-000000000018';
  admin_user  uuid := 'f1000000-0000-0000-0000-000000000020';
  outsider    uuid := 'f1000000-0000-0000-0000-000000000021';
begin
  insert into auth.users (id, email) values
    (owner_g, 'grant39@test.local'),
    (owner_l, 'live39@test.local'),
    (owner_t, 'trial39@test.local'),
    (owner_gr, 'grace39@test.local'),
    (owner_p, 'plan39@test.local'),
    (owner_r, 'revoke39@test.local'),
    (owner_e, 'empty39@test.local'),
    (owner_i, 'idem39@test.local'),
    (admin_user, 'admin39@test.local'),
    (outsider, 'outsider39@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_grant, 'Grant 39', 'CL', 'CLP', 'America/Santiago'),
    (hh_live, 'Live 39', 'CL', 'CLP', 'America/Santiago'),
    (hh_trial, 'Trial 39', 'NI', 'NIO', 'America/Managua'),
    (hh_grace, 'Grace 39', 'NI', 'NIO', 'America/Managua'),
    (hh_plan, 'Plan 39', 'CL', 'CLP', 'America/Santiago'),
    (hh_revoke, 'Revoke 39', 'CL', 'CLP', 'America/Santiago'),
    (hh_empty, 'Empty 39', 'CL', 'CLP', 'America/Santiago'),
    (hh_idem, 'Idem 39', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_grant, owner_g, 'owner', 'Grant 39'),
    (hh_live, owner_l, 'owner', 'Live 39'),
    (hh_trial, owner_t, 'owner', 'Trial 39'),
    (hh_grace, owner_gr, 'owner', 'Grace 39'),
    (hh_plan, owner_p, 'owner', 'Plan 39'),
    (hh_revoke, owner_r, 'owner', 'Revoke 39'),
    (hh_empty, owner_e, 'owner', 'Empty 39'),
    (hh_idem, owner_i, 'owner', 'Idem 39');

  -- Live plus row (one-live guard target).
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end) values
    (hh_live, 'plus', 'stub', 'active', now() + interval '30 days');

  -- Trialing row for extend_trial.
  insert into public.subscriptions (household_id, plan_code, provider, status, trial_ends_at, current_period_end) values
    (hh_trial, 'plus', 'stub', 'trialing', now() + interval '7 days', now() + interval '7 days');

  -- past_due row for extend_grace (check constraint needs grace_ends_at).
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end, grace_ends_at) values
    (hh_grace, 'plus', 'stub', 'past_due', now() - interval '2 days', now() + interval '5 days');

  -- Active plus row for change_plan.
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end) values
    (hh_plan, 'plus', 'stub', 'active', now() + interval '30 days');

  -- Active plus row for revoke.
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end) values
    (hh_revoke, 'plus', 'stub', 'active', now() + interval '30 days');

  insert into public.admin_users (user_id, role, note) values
    (admin_user, 'billing', 'test admin 39');
end
$$;

select plan(27);

select tests.authenticate_as('f1000000-0000-0000-0000-000000000020');

-- 1-2. Mandatory reason: NULL and blank reasons fail before touching state.
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000001', 'grant_comped', null, null, null) $$,
  '23514', 'admin override reason is required (3-2000 chars)',
  'grant without a reason: 23514'
);
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000001', 'grant_comped', null, null, '  ') $$,
  '23514', 'admin override reason is required (3-2000 chars)',
  'grant with a blank reason: 23514'
);

-- 3. Unknown action fails closed.
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000001', 'mint_money', null, null, 'support ticket 1') $$,
  '23514', 'unknown override action "mint_money"',
  'unknown action: 23514'
);

-- 4. Non-admin fails closed with 42501 (neutral 404 upstream).
select tests.authenticate_as('f1000000-0000-0000-0000-000000000021');
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000001', 'grant_comped', null, null, 'support ticket 2') $$,
  '42501', 'admin access denied',
  'outsider override: 42501'
);
select tests.authenticate_as('f1000000-0000-0000-0000-000000000020');

-- 5. grant_comped provisions a perpetual active/comped row.
select results_eq(
  $$ select plan_code, status, current_period_end from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000001', 'grant_comped', null, null, 'founder comp, ticket 39-1') $$,
  $$ values ('comped'::text, 'active'::text, null::timestamptz) $$,
  'grant_comped provisions active/comped with no period end'
);

-- 6. Grant audit captures reason, null before, comped after (superuser
-- read: the audit table has no authenticated policies by design).
select tests.clear_auth();
select results_eq(
  $$ select action, reason, before_state, after_state->>'plan_code'
      from public.admin_audit_log
     where target_household = 'f1000000-0000-0000-0000-000000000001'
       and action = 'subscription.grant_comped' $$,
  $$ values ('subscription.grant_comped'::text, 'founder comp, ticket 39-1'::text,
             null::jsonb, 'comped'::text) $$,
  'grant audit captures reason, null before, comped after'
);
select tests.authenticate_as('f1000000-0000-0000-0000-000000000020');

-- 7. grant_comped on an already-comped household is a natural-idempotent hit.
select results_eq(
  $$ select plan_code, status, was_idempotent from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000001', 'grant_comped', null, null, 'double click 39') $$,
  $$ values ('comped'::text, 'active'::text, true) $$,
  'grant_comped re-grant is idempotent (no second live row)'
);

-- 8. One-live respected: granting over a live plus row raises, never inserts.
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000002', 'grant_comped', null, null, 'should fail 39') $$,
  '23505', 'household already holds a live subscription (active)',
  'grant over a live plus row: one-live violation, no second row'
);
-- Household RLS hides other households' rows from the admin caller, so the
-- count assertion reads as superuser.
select tests.clear_auth();
select is(
  (select count(*)::int from public.subscriptions
    where household_id = 'f1000000-0000-0000-0000-000000000002'
      and status in ('trialing','active','past_due','grace','cancelled')),
  1,
  'live household still holds exactly one live row'
);
select tests.authenticate_as('f1000000-0000-0000-0000-000000000020');

-- 9-10. extend_trial moves the trial window; period end moves with it.
select results_eq(
  $$ select status, was_idempotent from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000003', 'extend_trial', null,
        now() + interval '14 days', 'trial extension, ticket 39-2') $$,
  $$ values ('trialing'::text, false) $$,
  'extend_trial keeps trialing status'
);
select tests.clear_auth();
select ok(
  (select trial_ends_at = current_period_end
     from public.subscriptions
    where household_id = 'f1000000-0000-0000-0000-000000000003'
      and status = 'trialing'),
  'extend_trial sets trial_ends_at and period end together'
);
select tests.authenticate_as('f1000000-0000-0000-0000-000000000020');

-- 11. extend_trial on a non-trialing row fails closed.
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000002', 'extend_trial', null,
        now() + interval '14 days', 'wrong status 39') $$,
  '23514', 'extend_trial needs a trialing subscription (found active)',
  'extend_trial on active: 23514'
);

-- 12. extend_grace pushes the dunning window.
select lives_ok(
  $$ select * from public.admin_override_subscription(
       'f1000000-0000-0000-0000-000000000004', 'extend_grace', null,
       now() + interval '10 days', 'grace extension, ticket 39-3') $$,
  'extend_grace applies on a past_due row'
);
select tests.clear_auth();
select ok(
  (select grace_ends_at > now() + interval '6 days'
     from public.subscriptions
    where household_id = 'f1000000-0000-0000-0000-000000000004'),
  'extend_grace pushed grace_ends_at into the new window'
);
select tests.authenticate_as('f1000000-0000-0000-0000-000000000020');

-- 13. extend_grace on a wrong-status row fails closed.
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000002', 'extend_grace', null,
        now() + interval '10 days', 'wrong status 39b') $$,
  '23514', 'extend_grace needs a past_due or grace subscription (found active)',
  'extend_grace on active: 23514'
);

-- 14. Past timestamps are rejected (no back-dating a window).
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000003', 'extend_trial', null,
        now() - interval '1 day', 'backdate 39') $$,
  '23514', 'extend_trial needs a future p_extend_to (within 5 years)',
  'extend_trial into the past: 23514'
);

-- 15. change_plan moves the live row (no new row).
select results_eq(
  $$ select plan_code, status from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000005', 'change_plan', 'free', null, 'downgrade, ticket 39-4') $$,
  $$ values ('free'::text, 'active'::text) $$,
  'change_plan moves plus -> free on the live row'
);

-- 16. Change-plan audit captures before/after plan with the reason.
select tests.clear_auth();
select results_eq(
  $$ select before_state->>'plan_code', after_state->>'plan_code', reason
      from public.admin_audit_log
     where target_household = 'f1000000-0000-0000-0000-000000000005'
       and action = 'subscription.change_plan' $$,
  $$ values ('plus'::text, 'free'::text, 'downgrade, ticket 39-4'::text) $$,
  'change_plan audit captures before/after plan with the reason'
);
select tests.authenticate_as('f1000000-0000-0000-0000-000000000020');

-- 17. Unknown plan codes fail closed.
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000005', 'change_plan', 'platinum', null, 'bogus 39') $$,
  '23514', 'unknown plan code "platinum"',
  'change_plan to an unknown plan: 23514'
);

-- 18. Revoke without confirmation fails without touching the row.
select throws_ok(
  $$ select * from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000006', 'revoke', null, null, 'no confirm 39') $$,
  '23514', 'revoking entitlement requires explicit confirmation',
  'revoke without confirm: 23514'
);
-- Same RLS note as above: the row-untouched check reads as superuser.
select tests.clear_auth();
select is(
  (select status from public.subscriptions
    where household_id = 'f1000000-0000-0000-0000-000000000006'
      and status in ('trialing','active','past_due','grace','cancelled')),
  'active',
  'unconfirmed revoke leaves the live row untouched'
);
select tests.authenticate_as('f1000000-0000-0000-0000-000000000020');

-- 19. Confirmed revoke expires the row.
select results_eq(
  $$ select status, current_period_end from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000006', 'revoke', null, null,
        'abuse, ticket 39-5', true) $$,
  $$ values ('expired'::text, null::timestamptz) $$,
  'confirmed revoke expires the live row'
);

-- 20. Revoke audit captures active -> expired.
select tests.clear_auth();
select results_eq(
  $$ select before_state->>'status', after_state->>'status'
      from public.admin_audit_log
     where target_household = 'f1000000-0000-0000-0000-000000000006'
       and action = 'subscription.revoke' $$,
  $$ values ('active'::text, 'expired'::text) $$,
  'revoke audit captures active -> expired'
);
select tests.authenticate_as('f1000000-0000-0000-0000-000000000020');

-- 21. Revoking a household with no live row is a no-op returning zero rows.
select is_empty(
  $$ select * from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000007', 'revoke', null, null,
        'already gone 39', true) $$,
  'revoke with no live row returns zero rows (idempotent no-op)'
);

-- 22. First keyed grant applies.
select results_eq(
  $$ select plan_code, status, was_idempotent from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000008', 'grant_comped', null, null,
        'keyed grant 39', false, 'key-39-1') $$,
  $$ values ('comped'::text, 'active'::text, false) $$,
  'first keyed grant applies'
);

-- 23. Replayed key returns the stored outcome as idempotent.
select results_eq(
  $$ select plan_code, status, was_idempotent from public.admin_override_subscription(
        'f1000000-0000-0000-0000-000000000008', 'grant_comped', null, null,
        'keyed grant 39', false, 'key-39-1') $$,
  $$ values ('comped'::text, 'active'::text, true) $$,
  'replayed key returns the stored outcome as idempotent'
);

-- 24. Replay writes no second audit row and no second subscription row.
select tests.clear_auth();
select results_eq(
  $$ select
       (select count(*)::int from public.admin_audit_log
         where target_household = 'f1000000-0000-0000-0000-000000000008'
           and idempotency_key = 'key-39-1'),
       (select count(*)::int from public.subscriptions
         where household_id = 'f1000000-0000-0000-0000-000000000008'
           and status in ('trialing','active','past_due','grace','cancelled')) $$,
  $$ values (1::int, 1::int) $$,
  'replay writes no second audit row and no second live row'
);

select * from finish();
