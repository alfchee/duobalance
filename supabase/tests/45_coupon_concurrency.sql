-- Coupon concurrency proof (#268 AC): the redemption count stays correct
-- under two concurrent attempts.
--
-- pgTAP runs in a single session, so two truly parallel backends cannot be
-- opened from inside this file. The proof therefore has three legs, matching
-- how redeem_coupon() is built:
--
-- 1. SERIALIZATION (test 5): the function locks the coupon row FOR UPDATE
--    before counting, so two concurrent redeems of the last slot serialize
--    instead of both passing the exhaustion check. The test pins the lock
--    in the function source so a future edit cannot silently drop it.
-- 2. WINNER/LOSER (tests 2-4): a cap-1 coupon goes to household A; the
--    second attempt (household B) is rejected as exhausted and the count is
--    exactly 1. Arrival order decides the winner — which is precisely what
--    the row lock guarantees under real concurrency: one winner, never two.
-- 3. BACKSTOP (tests 6-12): the UNIQUE (coupon_code, household_id) pair
--    holds at the storage level even outside the function (direct duplicate
--    insert raises 23505), and repeat attempts get the distinct
--    household-limit reason with counts unchanged.
--
-- Gating note (same as file 41): production revokes EXECUTE on
-- redeem_coupon() from authenticated — direct RPC would bypass
-- BILLING_ENABLED with no gated checkout yet. The grant below is
-- TEST-LOCAL (rolled back with the file); test 1 pins the production
-- absence.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_a    uuid := 'a5000000-0000-0000-0000-000000000001';
  hh_b    uuid := 'a5000000-0000-0000-0000-000000000002';
  owner_a uuid := 'a5000000-0000-0000-0000-000000000011';
  owner_b uuid := 'a5000000-0000-0000-0000-000000000012';
begin
  insert into auth.users (id, email) values
    (owner_a, 'cpa45@test.local'),
    (owner_b, 'cpb45@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_a, 'Race A45', 'CL', 'CLP', 'America/Santiago'),
    (hh_b, 'Race B45', 'NI', 'NIO', 'America/Managua');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_a, owner_a, 'owner', 'Race A45'),
    (hh_b, owner_b, 'owner', 'Race B45');

  -- RACE1: a single-slot campaign. RACE2: room for both households, so the
  -- double-redeem path is reachable without tripping exhaustion first
  -- (the function checks global exhaustion before the household limit).
  insert into public.coupons
    (code, discount_type, discount_value, currency, valid_from, valid_until,
     max_redemptions, per_household_limit, duration)
  values
    ('RACE1', 'percent', 20, null, now() - interval '1 day', now() + interval '30 days',
     1, 1, 'lifetime'),
    ('RACE2', 'percent', 10, null, now() - interval '1 day', now() + interval '30 days',
     10, 1, 'first_period');
end
$$;

select plan(12);

-- Gating. Production locks member redemption until a billing-gated checkout
-- ships it (#268): no EXECUTE for authenticated outside this file.
select ok(
  not has_function_privilege(
    'authenticated', 'public.redeem_coupon(text, uuid)', 'execute'
  ),
  'redeem_coupon: revoked from authenticated in production (flag boundary)'
);

-- Test-local grant for the behavior below (rolled back with the file).
grant execute on function public.redeem_coupon(text, uuid) to authenticated;

-- Two attempts, one slot: the first wins, the second sees exhaustion.
select tests.authenticate_as('a5000000-0000-0000-0000-000000000011');
select lives_ok(
  $$ select * from public.redeem_coupon(
        'RACE1', 'a5000000-0000-0000-0000-000000000001') $$,
  'race: first redeem of the last slot applies'
);
select tests.authenticate_as('a5000000-0000-0000-0000-000000000012');
select throws_ok(
  $$ select * from public.redeem_coupon(
        'RACE1', 'a5000000-0000-0000-0000-000000000002') $$,
  '23514', 'coupon is exhausted',
  'race: second redeem of the last slot is rejected as exhausted'
);
-- Counts read the tables directly, which authenticated cannot do by design
-- (no policies, no grants) — drop back to the session owner for these.
select tests.clear_auth();
select is(
  (select count(*)::int from public.coupon_redemptions where coupon_code = 'RACE1'),
  1,
  'race: redemption count is exactly 1 after two attempts on one slot'
);

-- Serialization leg: concurrent attempts serialize on the coupon row lock,
-- so the exhaustion count above cannot pass twice for one remaining slot.
-- Line comments are stripped before matching so the pin cannot be satisfied
-- by the explanatory comment alone — the FOR UPDATE clause must be present
-- in executable SQL.
select ok(
  (select regexp_replace(prosrc, '--[^\n]*', '', 'g') ilike '%for update%'
     from pg_proc
    where proname = 'redeem_coupon'
      and pg_function_is_visible(oid)),
  'redeem_coupon: holds a FOR UPDATE row lock before counting (concurrent attempts serialize)'
);

-- Double-redeem backstop on a coupon with room to spare.
select tests.authenticate_as('a5000000-0000-0000-0000-000000000011');
select lives_ok(
  $$ select * from public.redeem_coupon(
        'RACE2', 'a5000000-0000-0000-0000-000000000001') $$,
  'backstop: first redeem applies'
);
select throws_ok(
  $$ select * from public.redeem_coupon(
        'RACE2', 'a5000000-0000-0000-0000-000000000001') $$,
  '23514', 'household redemption limit reached',
  'backstop: same household, same coupon gets the household-limit reason'
);
select tests.authenticate_as('a5000000-0000-0000-0000-000000000012');
select lives_ok(
  $$ select * from public.redeem_coupon(
        'RACE2', 'a5000000-0000-0000-0000-000000000002') $$,
  'backstop: the other household still redeems (cap allows it)'
);
select throws_ok(
  $$ select * from public.redeem_coupon(
        'RACE2', 'a5000000-0000-0000-0000-000000000002') $$,
  '23514', 'household redemption limit reached',
  'backstop: second household cannot redeem twice either'
);
select tests.clear_auth();
select is(
  (select count(*)::int from public.coupon_redemptions where coupon_code = 'RACE2'),
  2,
  'backstop: RACE2 count is exactly 2 after four attempts'
);

-- Storage-level backstop: the unique pair rejects a duplicate row even for
-- a privileged writer outside the function, and the count is unchanged.
-- (Auth is already cleared from the count check above.)
select throws_like(
  $$ insert into public.coupon_redemptions (coupon_code, household_id)
     values ('RACE2', 'a5000000-0000-0000-0000-000000000002') $$,
  '%duplicate key value violates unique constraint%',
  'backstop: direct duplicate pair insert raises a unique violation'
);
select is(
  (select count(*)::int from public.coupon_redemptions where coupon_code = 'RACE2'),
  2,
  'backstop: RACE2 count is still 2 after the rejected duplicate'
);

select tests.clear_auth();
select * from finish();
