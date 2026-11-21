-- Admin coupon pagination: paged list, single-coupon reader, and paged
-- redemptions (code-review follow-up on #274). Zero-arg list calls keep
-- resolving through the new defaults.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_m       uuid := 'e6000000-0000-0000-0000-000000000001';
  owner_m    uuid := 'e6000000-0000-0000-0000-000000000011';
  admin_user uuid := 'e6000000-0000-0000-0000-000000000020';
  outsider   uuid := 'e6000000-0000-0000-0000-000000000021';
begin
  insert into auth.users (id, email) values
    (owner_m, 'cpm46@test.local'),
    (admin_user, 'admin46@test.local'),
    (outsider, 'outsider46@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_m, 'Coupon M46', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_m, owner_m, 'owner', 'Coupon M46');

  insert into public.admin_users (user_id, role, note) values
    (admin_user, 'billing', 'test admin 46');
end
$$;

select plan(10);

select tests.authenticate_as('e6000000-0000-0000-0000-000000000020');

-- Seed two coupons.
select lives_ok(
  $$ select * from public.admin_create_coupon(
        'PAGE46A', 'percent', 10, null,
        now() - interval '1 day', now() + interval '30 days',
        500, 1, 'lifetime', 'pagination probe 46a') $$,
  'first coupon creates'
);

select lives_ok(
  $$ select * from public.admin_create_coupon(
        'PAGE46B', 'percent', 20, null,
        now() - interval '1 day', now() + interval '30 days',
        500, 1, 'lifetime', 'pagination probe 46b') $$,
  'second coupon creates'
);

-- 1. Zero-arg list still resolves (defaults) and sees both coupons.
select results_eq(
  $$ select count(*)::int from public.admin_list_coupons() where code like 'PAGE46%' $$,
  $$ values (2) $$,
  'zero-arg list resolves through defaults'
);

-- 2. Limit 1 returns a one-row page.
select results_eq(
  $$ select count(*)::int from public.admin_list_coupons(1, 0) $$,
  $$ values (1) $$,
  'limit 1 returns a one-row page'
);

-- 3. Limit/offset pages walk the full set (both seeds across two pages;
-- created_at ties make row order arbitrary, so assert the union).
select results_eq(
  $$ (select code from public.admin_list_coupons(1, 0) where code like 'PAGE46%')
     union
     (select code from public.admin_list_coupons(1, 1) where code like 'PAGE46%')
     order by 1 $$,
  $$ values ('PAGE46A'::text), ('PAGE46B'::text) $$,
  'offset pages reach the rest of the set'
);

-- 4. Single-coupon reader returns the row with live counts.
select results_eq(
  $$ select code, redemption_count, remaining_capacity from public.admin_get_coupon('page46a') $$,
  $$ values ('PAGE46A'::text, 0::bigint, 500::bigint) $$,
  'single reader finds by code, case-insensitive, with counts'
);

-- 5. Single reader on unknown codes returns zero rows (route → neutral 404).
select is_empty(
  $$ select * from public.admin_get_coupon('NOPE46') $$,
  'unknown code: zero rows'
);

-- 6. Redemptions page: empty before any redemption.
select is_empty(
  $$ select * from public.admin_get_coupon_redemptions('PAGE46A', 10, 0) $$,
  'no redemptions yet'
);

-- 7. Non-admins are denied on the new readers.
select tests.authenticate_as('e6000000-0000-0000-0000-000000000021');

select throws_ok(
  $$ select * from public.admin_get_coupon('PAGE46A') $$,
  '42501', 'admin access denied',
  'single reader denies non-admins'
);

select throws_ok(
  $$ select * from public.admin_get_coupon_redemptions('PAGE46A', 10, 0) $$,
  '42501', 'admin access denied',
  'paged redemptions deny non-admins'
);

select tests.clear_auth();
select * from finish();
