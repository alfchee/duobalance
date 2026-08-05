-- Member management: only owners can delete household_members rows.
-- Partners can read; only owners can mutate.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_id    uuid := '33333333-3333-3333-3333-333333333333';
  owner_id uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  partner_id uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  owner_member   uuid := 'c1c1c1c1-1111-1111-1111-111111111111';
  partner_member uuid := 'd1d1d1d1-2222-2222-2222-222222222222';
begin
  insert into auth.users (id, email) values
    (owner_id,   'owner@test.local'),
    (partner_id, 'partner@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_id, 'Two Partners', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_member,   hh_id, owner_id,   'owner',   'Owner'),
    (partner_member, hh_id, partner_id, 'partner', 'Partner');
end
$$;

select plan(5);

-- ============================================================================
-- As partner
-- ============================================================================
select tests.authenticate_as('dddddddd-dddd-dddd-dddd-dddddddddddd');

-- 1. Partner can see both members
select results_eq(
  $$ select count(*)::int from public.household_members $$,
  $$ values (2::int) $$,
  'partner sees both members'
);

-- 2. Partner cannot delete the owner
select results_eq(
  $$ with deleted as (
       delete from public.household_members
         where id = 'c1c1c1c1-1111-1111-1111-111111111111'::uuid
         returning 1
     )
     select count(*)::int from deleted $$,
  $$ values (0::int) $$,
  'partner DELETE on owner: 0 rows (RLS blocks)'
);

-- 3. Partner cannot even delete themselves
select results_eq(
  $$ with deleted as (
       delete from public.household_members
         where id = 'd1d1d1d1-2222-2222-2222-222222222222'::uuid
         returning 1
     )
     select count(*)::int from deleted $$,
  $$ values (0::int) $$,
  'partner DELETE on self: 0 rows (RLS blocks; only owner can remove members)'
);

-- 4. Partner cannot INSERT a third member (no INSERT policy)
select throws_ok(
  $$ insert into public.household_members
       (household_id, user_id, role, display_name)
     values (
       '33333333-3333-3333-3333-333333333333',
       'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
       'partner',
       'Sneaky'
     ) $$,
  '42501',
  null,
  'partner cannot INSERT members'
);

-- ============================================================================
-- As owner
-- ============================================================================
select tests.authenticate_as('cccccccc-cccc-cccc-cccc-cccccccccccc');

-- 5. Owner CAN delete the partner
select results_eq(
  $$ with deleted as (
       delete from public.household_members
         where id = 'd1d1d1d1-2222-2222-2222-222222222222'::uuid
         returning 1
     )
     select count(*)::int from deleted $$,
  $$ values (1::int) $$,
  'owner DELETE on partner: 1 row removed'
);

select * from finish();
rollback;
