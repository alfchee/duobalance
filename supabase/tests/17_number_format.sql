\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  household_id uuid := '17171717-1717-1717-1717-171717171717';
  owner_id uuid := '18181818-1818-1818-1818-181818181818';
  partner_id uuid := '19191919-1919-1919-1919-191919191919';
  owner_member_id uuid := '11111111-1111-1111-1111-111111111111';
  partner_member_id uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into auth.users (id, email) values
    (owner_id, 'number-owner@test.local'),
    (partner_id, 'number-partner@test.local');
  insert into public.households (id, name, country, base_currency, timezone) values
    (household_id, 'Number formats', 'NI', 'NIO', 'America/Managua');
  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_member_id, household_id, owner_id, 'owner', 'Owner'),
    (partner_member_id, household_id, partner_id, 'partner', 'Partner');
end
$$;

select plan(5);

select tests.authenticate_as('18181818-1818-1818-1818-181818181818');
select lives_ok(
  $$ select public.update_my_number_format('11111111-1111-1111-1111-111111111111', 'dot_decimal') $$,
  'a member can update their own number format'
);
select results_eq(
  $$ select number_format from public.household_members where id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('dot_decimal'::text) $$,
  'owner preference is stored'
);
select results_eq(
  $$ select number_format from public.household_members where id = '22222222-2222-2222-2222-222222222222' $$,
  $$ values ('locale'::text) $$,
  'partner retains an independent default preference'
);
select throws_ok(
  $$ select public.update_my_number_format('22222222-2222-2222-2222-222222222222', 'comma_decimal') $$,
  'P0001',
  'membership not found',
  'member cannot update another member preference'
);
select throws_ok(
  $$ select public.update_my_number_format('22222222-2222-2222-2222-222222222222', 'invalid') $$,
  'P0001',
  'invalid number format',
  'invalid preferences are rejected'
);

select * from finish();
rollback;
