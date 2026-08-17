\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  -- Household 1: Multi-member household (owner + partner)
  hh1_id          uuid := '71000000-0000-0000-0000-000000000001';
  owner1_user     uuid := '71000000-0000-0000-0000-000000000002';
  owner1_member   uuid := '71000000-0000-0000-0000-000000000003';
  partner1_user   uuid := '71000000-0000-0000-0000-000000000004';
  partner1_member uuid := '71000000-0000-0000-0000-000000000005';

  -- Household 2: Single-member household (owner only)
  hh2_id          uuid := '72000000-0000-0000-0000-000000000001';
  owner2_user     uuid := '72000000-0000-0000-0000-000000000002';
  owner2_member   uuid := '72000000-0000-0000-0000-000000000003';

  -- Household 3: Household to test direct delete_household
  hh3_id          uuid := '73000000-0000-0000-0000-000000000001';
  owner3_user     uuid := '73000000-0000-0000-0000-000000000002';
  owner3_member   uuid := '73000000-0000-0000-0000-000000000003';
  partner3_user   uuid := '73000000-0000-0000-0000-000000000004';
  partner3_member uuid := '73000000-0000-0000-0000-000000000005';

  -- Stranger user (member of no household)
  stranger_user   uuid := '74000000-0000-0000-0000-000000000001';
begin
  insert into auth.users (id, email) values
    (owner1_user, 'owner1_23@test.local'),
    (partner1_user, 'partner1_23@test.local'),
    (owner2_user, 'owner2_23@test.local'),
    (owner3_user, 'owner3_23@test.local'),
    (partner3_user, 'partner3_23@test.local'),
    (stranger_user, 'stranger_23@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh1_id, 'Multi Member HH', 'CL', 'CLP', 'America/Santiago'),
    (hh2_id, 'Single Member HH', 'CL', 'CLP', 'America/Santiago'),
    (hh3_id, 'Deletion HH', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner1_member, hh1_id, owner1_user, 'owner', 'Owner 1'),
    (partner1_member, hh1_id, partner1_user, 'partner', 'Partner 1'),
    (owner2_member, hh2_id, owner2_user, 'owner', 'Owner 2'),
    (owner3_member, hh3_id, owner3_user, 'owner', 'Owner 3'),
    (partner3_member, hh3_id, partner3_user, 'partner', 'Partner 3');
end
$$;

select plan(12);

-- ============================================================================
-- 1. delete_household authorization checks
-- ============================================================================

-- Stranger (non-member) cannot delete_household
select tests.authenticate_as('74000000-0000-0000-0000-000000000001', 'stranger_23@test.local');
select throws_ok(
  $$ select public.delete_household('73000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'only active owners can delete a household',
  'delete_household rejects non-members'
);

-- Partner (non-owner member) cannot delete_household
select tests.authenticate_as('73000000-0000-0000-0000-000000000004', 'partner3_23@test.local');
select throws_ok(
  $$ select public.delete_household('73000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'only active owners can delete a household',
  'delete_household rejects non-owner members'
);

-- Owner can delete_household
select tests.authenticate_as('73000000-0000-0000-0000-000000000002', 'owner3_23@test.local');
select lives_ok(
  $$ select public.delete_household('73000000-0000-0000-0000-000000000001'::uuid) $$,
  'owner can delete household'
);

-- Soft-deleting revokes access for all members immediately
select ok(
  not public.is_member('73000000-0000-0000-0000-000000000001'::uuid),
  'owner loses access via is_member() after soft delete'
);

select tests.authenticate_as('73000000-0000-0000-0000-000000000004', 'partner3_23@test.local');
select ok(
  not public.is_member('73000000-0000-0000-0000-000000000001'::uuid),
  'partner loses access via is_member() after soft delete'
);

-- ============================================================================
-- 2. leave_household checks
-- ============================================================================

-- Owner of multi-member household cannot leave without transferring ownership
select tests.authenticate_as('71000000-0000-0000-0000-000000000002', 'owner1_23@test.local');
select throws_ok(
  $$ select public.leave_household('71000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'owners cannot leave a household with remaining members; transfer ownership first',
  'leave_household rejects owner when other members remain'
);

-- Non-owner member in multi-member household can leave
select tests.authenticate_as('71000000-0000-0000-0000-000000000004', 'partner1_23@test.local');
select lives_ok(
  $$ select public.leave_household('71000000-0000-0000-0000-000000000001'::uuid) $$,
  'partner can leave multi-member household'
);

select ok(
  not public.is_member('71000000-0000-0000-0000-000000000001'::uuid),
  'partner loses access after leaving'
);

-- Authenticate as remaining owner1 to inspect household_members table
select tests.authenticate_as('71000000-0000-0000-0000-000000000002', 'owner1_23@test.local');

-- Verify partner removed_at, removal_reason, removed_by
select results_eq(
  $$ select removal_reason, removed_by
     from public.household_members
     where id = '71000000-0000-0000-0000-000000000005'
       and removed_at is not null $$,
  $$ values ('left', '71000000-0000-0000-0000-000000000005'::uuid) $$,
  'leave_household sets removal_reason = left and removed_by = self'
);

-- Now owner1 is the last remaining active member in household 1
select lives_ok(
  $$ select public.leave_household('71000000-0000-0000-0000-000000000001'::uuid) $$,
  'last member leaving delegates to delete_household and closes household'
);

select ok(
  not public.is_member('71000000-0000-0000-0000-000000000001'::uuid),
  'last member loses access after leaving closed household'
);

-- Single member household owner leaving also closes household
select tests.authenticate_as('72000000-0000-0000-0000-000000000002', 'owner2_23@test.local');
select lives_ok(
  $$ select public.leave_household('72000000-0000-0000-0000-000000000001'::uuid) $$,
  'single owner leaving closes household'
);

select * from finish();
rollback;
