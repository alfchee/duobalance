-- Issue #274 PR #303 review follow-ups: list carries updated_at and
-- minor_unit; creation enforces per-household limit 1; unknown codes stay
-- reported distinctly at the function level (the route maps them to the
-- neutral 404).

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  admin_user uuid := 'c5000000-0000-0000-0000-000000000020';
begin
  insert into auth.users (id, email) values
    (admin_user, 'admin43@test.local');

  insert into public.admin_users (user_id, role, note) values
    (admin_user, 'billing', 'test admin 43');
end
$$;

select plan(5);

select tests.authenticate_as('c5000000-0000-0000-0000-000000000020');

-- 1. An amount coupon creates under the limit-1 rule.
select lives_ok(
  $$ select * from public.admin_create_coupon(
        'AMT43', 'amount', 500, 'NIO',
        now() - interval '1 day', now() + interval '30 days',
        50, 1, 'first_period', 'review probe 43') $$,
  'amount coupon with limit 1 creates'
);

-- 2. The list carries updated_at (never null) and the currency's own
-- minor_unit for display formatting (NIO = 2).
select results_eq(
  $$ select code, updated_at is not null, minor_unit from public.admin_list_coupons()
     where code = 'AMT43' $$,
  $$ values ('AMT43'::text, true, 2::smallint) $$,
  'list carries updated_at and NIO minor_unit'
);

-- 3. Limits above 1 are rejected with their own reason (the unique pair
-- could never deliver them).
select throws_ok(
  $$ select * from public.admin_create_coupon(
        'LIM43', 'percent', 10, null,
        now() - interval '1 day', now() + interval '30 days',
        50, 5, 'lifetime', 'review probe 43b') $$,
  '23514', 'per-household limit is 1 by design (one redemption per household per coupon)',
  'limit above 1: rejected with the design reason'
);

-- 4. The range check still fires first for out-of-range limits.
select throws_ok(
  $$ select * from public.admin_create_coupon(
        'LIMZERO', 'percent', 10, null,
        now() - interval '1 day', now() + interval '30 days',
        50, 0, 'lifetime', 'review probe 43c') $$,
  '23514', 'per-household limit must sit inside 1..max_redemptions',
  'limit zero: range reason (check ordering pinned)'
);

-- 5. Unknown codes stay distinct at the function level (the route maps
-- this message to the neutral 404).
select throws_ok(
  $$ select * from public.admin_set_coupon_active(
        'NOPE99', false, 'review probe 43d') $$,
  '23514', 'unknown coupon "NOPE99"',
  'set_active on unknown code: distinct unknown reason'
);

select tests.clear_auth();
select * from finish();
