-- Issue #274: admin coupon management — explicit creation, live counts,
-- deactivation preserving history, redeemed-terms immutability, and
-- identifier-only redemption visibility.
--
-- Audit assertions read as superuser (clear_auth): admin_audit_log carries
-- no authenticated policies by design (see test 39 header).

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_m       uuid := 'b4000000-0000-0000-0000-000000000001';
  owner_m    uuid := 'b4000000-0000-0000-0000-000000000011';
  admin_user uuid := 'b4000000-0000-0000-0000-000000000020';
  outsider   uuid := 'b4000000-0000-0000-0000-000000000021';
begin
  insert into auth.users (id, email) values
    (owner_m, 'cpm42@test.local'),
    (admin_user, 'admin42@test.local'),
    (outsider, 'outsider42@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_m, 'Coupon M42', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_m, owner_m, 'owner', 'Coupon M42');

  insert into public.admin_users (user_id, role, note) values
    (admin_user, 'billing', 'test admin 42');
end
$$;

select plan(25);

select tests.authenticate_as('b4000000-0000-0000-0000-000000000020');

-- 1. Happy-path creation with every constraint explicit.
select results_eq(
  $$ select code, discount_type, discount_value, active from public.admin_create_coupon(
        'BLOG20', 'percent', 20, null,
        now() - interval '1 day', now() + interval '30 days',
        500, 1, 'lifetime', 'blogger campaign, ticket 42-1') $$,
  $$ values ('BLOG20'::text, 'percent'::text, 20::int, true) $$,
  'create coupon with explicit constraints'
);

-- 2. Creation audit: reason recorded, null before, row after.
select tests.clear_auth();
select results_eq(
  $$ select action, reason, before_state, after_state->>'code'
      from public.admin_audit_log
     where action = 'coupon.create' and after_state->>'code' = 'BLOG20' $$,
  $$ values ('coupon.create'::text, 'blogger campaign, ticket 42-1'::text,
             null::jsonb, 'BLOG20'::text) $$,
  'create audit captures reason, null before, row after'
);
select tests.authenticate_as('b4000000-0000-0000-0000-000000000020');

-- 3. No reason, no coupon.
select throws_ok(
  $$ select * from public.admin_create_coupon(
        'NOREASON', 'percent', 10, null,
        now() - interval '1 day', now() + interval '30 days',
        10, 1, 'lifetime', null) $$,
  '23514', 'admin coupon reason is required (3-2000 chars)',
  'create without a reason: 23514'
);

-- 4. Code shape enforced (4-32 chars, A-Z/0-9/_/-).
select throws_ok(
  $$ select * from public.admin_create_coupon(
        'ab', 'percent', 10, null,
        now() - interval '1 day', now() + interval '30 days',
        10, 1, 'lifetime', 'ticket 42-2') $$,
  '23514', 'coupon code must be 4-32 chars: A-Z, 0-9, _ or -',
  'short code: 23514'
);

-- 5-7. Discount validation: percent range, amount currency rules.
select throws_ok(
  $$ select * from public.admin_create_coupon(
        'BADPCT', 'percent', 150, null,
        now() - interval '1 day', now() + interval '30 days',
        10, 1, 'lifetime', 'ticket 42-3') $$,
  '23514', 'percent discount must be 1-100',
  'percent over 100: 23514'
);
select throws_ok(
  $$ select * from public.admin_create_coupon(
        'NOCCY', 'amount', 500, null,
        now() - interval '1 day', now() + interval '30 days',
        10, 1, 'lifetime', 'ticket 42-4') $$,
  '23514', 'amount coupons require a currency',
  'amount without currency: 23514'
);
select throws_ok(
  $$ select * from public.admin_create_coupon(
        'BADCCY', 'amount', 500, 'XX1',
        now() - interval '1 day', now() + interval '30 days',
        10, 1, 'lifetime', 'ticket 42-5') $$,
  '23514', 'unknown currency "XX1"',
  'amount with unknown currency: 23514'
);

-- 8-9. Window validation: ordered and ending in the future.
select throws_ok(
  $$ select * from public.admin_create_coupon(
        'BADWIN', 'percent', 10, null,
        now() + interval '30 days', now() - interval '1 day',
        10, 1, 'lifetime', 'ticket 42-6') $$,
  '23514', 'validity window must be ordered (valid_from < valid_until)',
  'unordered window: 23514'
);
select throws_ok(
  $$ select * from public.admin_create_coupon(
        'DEADONARR', 'percent', 10, null,
        now() - interval '30 days', now() - interval '1 day',
        10, 1, 'lifetime', 'ticket 42-7') $$,
  '23514', 'validity window must end in the future',
  'stillborn window: 23514'
);

-- 10. per-household limit must sit inside 1..max_redemptions.
select throws_ok(
  $$ select * from public.admin_create_coupon(
        'BADLIM', 'percent', 10, null,
        now() - interval '1 day', now() + interval '30 days',
        5, 9, 'lifetime', 'ticket 42-8') $$,
  '23514', 'per-household limit must sit inside 1..max_redemptions',
  'limit above cap: 23514'
);

-- 11. Duplicate codes raise, never duplicate.
select throws_ok(
  $$ select * from public.admin_create_coupon(
        'BLOG20', 'percent', 10, null,
        now() - interval '1 day', now() + interval '30 days',
        10, 1, 'lifetime', 'ticket 42-9') $$,
  '23505', 'coupon code "BLOG20" already exists',
  'duplicate code: 23505'
);

-- 12. List carries accurate counts and remaining capacity.
select results_eq(
  $$ select code, discount_type, discount_value, active from public.admin_create_coupon(
        'LIST10', 'percent', 10, null,
        now() - interval '1 day', now() + interval '30 days',
        100, 1, 'first_period', 'list probe 42') $$,
  $$ values ('LIST10'::text, 'percent'::text, 10::int, true) $$,
  'second coupon created for the list probe'
);
select tests.authenticate_as('b4000000-0000-0000-0000-000000000011');
select lives_ok(
  $$ select * from public.redeem_coupon(
        'LIST10', 'b4000000-0000-0000-0000-000000000001') $$,
  'member redeems LIST10 once'
);
select tests.authenticate_as('b4000000-0000-0000-0000-000000000020');
select results_eq(
  $$ select code, redemption_count, remaining_capacity from public.admin_list_coupons()
     where code = 'LIST10' $$,
  $$ values ('LIST10'::text, 1::bigint, 99::bigint) $$,
  'list shows accurate redemption count and remaining capacity'
);

-- 13-15. Deactivation preserves history and immediately blocks redeems.
select results_eq(
  $$ select code, active, was_idempotent from public.admin_set_coupon_active(
        'LIST10', false, 'abuse wave, ticket 42-10') $$,
  $$ values ('LIST10'::text, false, false) $$,
  'deactivation flips active to false'
);
select tests.clear_auth();
select is(
  (select count(*)::int from public.coupon_redemptions where coupon_code = 'LIST10'),
  1,
  'deactivation preserves the redemption history row'
);
select tests.authenticate_as('b4000000-0000-0000-0000-000000000011');
select throws_ok(
  $$ select * from public.redeem_coupon(
        'LIST10', 'b4000000-0000-0000-0000-000000000001') $$,
  '23514', 'coupon is deactivated',
  'redeem after deactivation: deactivated reason'
);
select tests.authenticate_as('b4000000-0000-0000-0000-000000000020');

-- 16. Redeemed terms are locked: value edits fail underneath the API.
select tests.clear_auth();
select throws_ok(
  $$ update public.coupons set discount_value = 50 where code = 'LIST10' $$,
  '23514', 'redeemed coupon terms are locked; deactivation is the only change',
  'value edit on a redeemed coupon: locked'
);

-- 17. Reactivation of a redeemed coupon is locked too.
select tests.authenticate_as('b4000000-0000-0000-0000-000000000020');
select throws_ok(
  $$ select * from public.admin_set_coupon_active(
        'LIST10', true, 'oops, ticket 42-11') $$,
  '23514', 'redeemed coupon terms are locked; deactivation is the only change',
  'reactivation of a redeemed coupon: locked'
);

-- 18-19. Unredeemed coupons stay fully editable (the lock is scoped to
-- redeemed terms, not to the table).
select tests.clear_auth();
select lives_ok(
  $$ update public.coupons set discount_value = 25 where code = 'BLOG20' $$,
  'value edit on an unredeemed coupon applies'
);
select is(
  (select discount_value from public.coupons where code = 'BLOG20'),
  25,
  'unredeemed edit landed'
);

-- 20. Redemption output has no personal-data column (identifiers only).
select is_empty(
  $$ select parameter_name from information_schema.parameters
      where specific_schema = 'public'
        and specific_name ilike '%admin\_get\_coupon\_redemptions%'
        and parameter_mode = 'OUT'
        and parameter_name in ('email', 'display_name', 'name') $$,
  'redemption output carries no personal-data column'
);

-- 21. ...and returns the redeeming household identifier.
select tests.authenticate_as('b4000000-0000-0000-0000-000000000020');
select results_eq(
  $$ select coupon_code, household_id::text from public.admin_get_coupon_redemptions('LIST10') $$,
  $$ values ('LIST10'::text, 'b4000000-0000-0000-0000-000000000001'::text) $$,
  'redemption list shows the household identifier'
);

-- 22-23. Non-admins fail closed on both write and list paths.
select tests.authenticate_as('b4000000-0000-0000-0000-000000000021');
select throws_ok(
  $$ select * from public.admin_create_coupon(
        'EVIL99', 'percent', 99, null,
        now() - interval '1 day', now() + interval '30 days',
        9, 1, 'lifetime', 'ticket 42-12') $$,
  '42501', 'admin access denied',
  'outsider create: 42501'
);
select throws_ok(
  $$ select * from public.admin_list_coupons() $$,
  '42501', 'admin access denied',
  'outsider list: 42501'
);

select tests.clear_auth();
select * from finish();
