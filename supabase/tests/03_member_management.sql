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
  -- A second partner who owns an account — the accounts.owner_member_id FK is
  -- on delete restrict (#19), so this member must be un-removable while the
  -- account exists.
  partner2_user   uuid := 'e2e2e2e2-2222-2222-2222-222222222222';
  partner2_member uuid := 'e3e3e3e3-3333-3333-3333-333333333333';
  acct_owned      uuid := 'f4f4f4f4-4444-4444-4444-444444444444';
begin
  insert into auth.users (id, email) values
    (owner_id,    'owner@test.local'),
    (partner_id,  'partner@test.local'),
    (partner2_user, 'partner2@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_id, 'Two Partners', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_member,   hh_id, owner_id,   'owner',   'Owner'),
    (partner_member, hh_id, partner_id, 'partner', 'Partner'),
    (partner2_member, hh_id, partner2_user, 'partner', 'Partner2');

  -- Partner2 owns an account (joint-style account in the same household), so
  -- removing them must be blocked by the accounts FK restrict.
  insert into public.accounts
    (id, household_id, name, kind, currency, owner_member_id) values
    (acct_owned, hh_id, 'Partner2 checking', 'checking', 'CLP', partner2_member);
end
$$;

select plan(6);

-- ============================================================================
-- As partner
-- ============================================================================
select tests.authenticate_as('dddddddd-dddd-dddd-dddd-dddddddddddd');

-- 1. Partner can see all members
select results_eq(
  $$ select count(*)::int from public.household_members $$,
  $$ values (3::int) $$,
  'partner sees all three members'
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

-- 5. Owner CAN delete the partner (partner owns no accounts, so no FK blocks)
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

-- 6. But a member who still owns an account cannot be removed — the
-- accounts.owner_member_id FK is on delete restrict (#19).
select throws_ok(
  $$ delete from public.household_members
     where id = 'e3e3e3e3-3333-3333-3333-333333333333'::uuid $$,
  '23503',
  null,
  'owner cannot DELETE a partner who still owns accounts (FK restrict)'
);

select * from finish();
rollback;
