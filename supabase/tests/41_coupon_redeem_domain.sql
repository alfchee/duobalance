-- Coupon domain (#268 substrate): redeem validation with distinct reasons,
-- double-redemption guards, and RLS proving households cannot enumerate
-- codes.
--
-- Gating note (PR #303 review): production revokes EXECUTE on
-- redeem_coupon() from authenticated — direct RPC would bypass
-- BILLING_ENABLED with no gated checkout yet (#268 re-grants if it ships
-- one). The grant below is TEST-LOCAL (rolled back with the file) so the
-- member-path behavior stays covered; test 1 pins the production absence.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_a     uuid := 'a3000000-0000-0000-0000-000000000001';
  hh_b     uuid := 'a3000000-0000-0000-0000-000000000002';
  owner_a  uuid := 'a3000000-0000-0000-0000-000000000011';
  owner_b  uuid := 'a3000000-0000-0000-0000-000000000012';
  stranger uuid := 'a3000000-0000-0000-0000-000000000013';
begin
  insert into auth.users (id, email) values
    (owner_a, 'cpa41@test.local'),
    (owner_b, 'cpb41@test.local'),
    (stranger, 'cps41@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'Coupon A41', 'CL', 'CLP', 'America/Santiago'),
    (hh_b, 'Coupon B41', 'NI', 'NIO', 'America/Managua');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_a, owner_a, 'owner', 'Coupon A41'),
    (hh_b, owner_b, 'owner', 'Coupon B41');

  -- Live campaign coupon: percent 20, cap 2, one per household.
  -- (ONE1 carries its NIO currency inline: amount rows must satisfy the
  -- currency-scope check at insert time.)
  insert into public.coupons
    (code, discount_type, discount_value, currency, valid_from, valid_until,
     max_redemptions, per_household_limit, duration)
  values
    ('SAVE20', 'percent', 20, null, now() - interval '1 day', now() + interval '30 days',
     2, 1, 'lifetime'),
    ('EXPIRED1', 'percent', 10, null, now() - interval '30 days', now() - interval '1 day',
     10, 1, 'first_period'),
    ('FUTURE1', 'percent', 10, null, now() + interval '1 day', now() + interval '30 days',
     10, 1, 'first_period'),
    ('OFF1', 'percent', 10, null, now() - interval '1 day', now() + interval '30 days',
     10, 1, 'first_period'),
    ('ONE1', 'amount', 500, 'NIO', now() - interval '1 day', now() + interval '30 days',
     1, 1, 'first_period');

  update public.coupons set active = false where code = 'OFF1';
end
$$;

select plan(15);

-- Gating. Production locks member redemption until a billing-gated checkout
-- ships it (#268): no EXECUTE for authenticated outside this file.
select ok(
  not has_function_privilege(
    'authenticated', 'public.redeem_coupon(text, uuid)', 'execute'
  ),
  'redeem_coupon: revoked from authenticated in production (flag boundary)'
);

-- Test-local grant for the member-path behavior below (rolled back with
-- the file; production stays locked per test 1).
grant execute on function public.redeem_coupon(text, uuid) to authenticated;

-- 1. Happy path: a member redeems a live code for their own household.
select tests.authenticate_as('a3000000-0000-0000-0000-000000000011');
select results_eq(
  $$ select coupon_code, household_id::text from public.redeem_coupon(
        'SAVE20', 'a3000000-0000-0000-0000-000000000001') $$,
  $$ values ('SAVE20'::text, 'a3000000-0000-0000-0000-000000000001'::text) $$,
  'member redeems a live coupon for their household'
);

-- 2. Same household, same coupon: household-limit reason (the unique pair
-- underneath is the storage backstop; the function answers first).
select throws_ok(
  $$ select * from public.redeem_coupon(
        'SAVE20', 'a3000000-0000-0000-0000-000000000001') $$,
  '23514', 'household redemption limit reached',
  'second redeem by the same household: household-limit reason'
);

-- 3-6. Distinct reasons per failure mode.
select throws_ok(
  $$ select * from public.redeem_coupon(
        'EXPIRED1', 'a3000000-0000-0000-0000-000000000001') $$,
  '23514', 'coupon has expired',
  'expired coupon: expired reason'
);
select throws_ok(
  $$ select * from public.redeem_coupon(
        'FUTURE1', 'a3000000-0000-0000-0000-000000000001') $$,
  '23514', 'coupon is not yet valid',
  'scheduled coupon: not-yet-valid reason'
);
select throws_ok(
  $$ select * from public.redeem_coupon(
        'OFF1', 'a3000000-0000-0000-0000-000000000001') $$,
  '23514', 'coupon is deactivated',
  'deactivated coupon: deactivated reason'
);
select throws_ok(
  $$ select * from public.redeem_coupon(
        'NOPE99', 'a3000000-0000-0000-0000-000000000001') $$,
  '23514', 'unknown coupon',
  'unknown code: unknown reason'
);

-- 7. Exhaustion: ONE1 (cap 1) goes to B, then A finds it exhausted.
select tests.authenticate_as('a3000000-0000-0000-0000-000000000012');
select lives_ok(
  $$ select * from public.redeem_coupon(
        'ONE1', 'a3000000-0000-0000-0000-000000000002') $$,
  'first redeem of a cap-1 coupon applies'
);
select tests.authenticate_as('a3000000-0000-0000-0000-000000000011');
select throws_ok(
  $$ select * from public.redeem_coupon(
        'ONE1', 'a3000000-0000-0000-0000-000000000001') $$,
  '23514', 'coupon is exhausted',
  'cap reached: exhausted reason (global before household)'
);

-- 8. Non-members cannot redeem into a household they do not belong to.
select tests.authenticate_as('a3000000-0000-0000-0000-000000000013');
select throws_ok(
  $$ select * from public.redeem_coupon(
        'SAVE20', 'a3000000-0000-0000-0000-000000000001') $$,
  '42501', 'not a member of this household',
  'stranger redeem: 42501'
);

-- 9. The unique pair holds at the storage level too: a direct second row
-- for the same pair aborts even for privileged writers.
select tests.clear_auth();
select lives_ok(
  $$ insert into public.coupon_redemptions (coupon_code, household_id)
     values ('SAVE20', 'a3000000-0000-0000-0000-000000000002') $$,
  'second household redeems SAVE20 (cap 2 allows it)'
);
select throws_like(
  $$ insert into public.coupon_redemptions (coupon_code, household_id)
     values ('SAVE20', 'a3000000-0000-0000-0000-000000000002') $$,
  '%duplicate key value violates unique constraint%',
  'direct duplicate pair insert: unique violation'
);

-- 10-11. Households cannot enumerate codes: no grants, no policies.
select tests.authenticate_anon();
select throws_like(
  $$ select * from public.coupons $$,
  '%permission denied%',
  'anon coupon list: denied'
);
select tests.authenticate_as('a3000000-0000-0000-0000-000000000011');
select throws_like(
  $$ select * from public.coupons $$,
  '%permission denied%',
  'authenticated coupon list: denied (redeem-by-code is the only path)'
);

-- 12. Codes canonicalize: a lowercase input must resolve to the canonical
-- upper row. SAVE20 is exhausted by now, so the proof is indirect but
-- exact: 'save20' reports exhaustion, not 'unknown coupon' — the lookup
-- found the row, which only the normalization can explain.
select throws_ok(
  $$ select * from public.redeem_coupon(
        'save20', 'a3000000-0000-0000-0000-000000000001') $$,
  '23514', 'coupon is exhausted',
  'lowercase code resolves to the canonical coupon (exhausted, not unknown)'
);

select tests.clear_auth();
select * from finish();
