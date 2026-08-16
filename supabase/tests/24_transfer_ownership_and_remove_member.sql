\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  -- Household 1: Owner (Alice) & Partner (Bob)
  hh1_id          uuid := '81000000-0000-0000-0000-000000000001';
  alice_user      uuid := '81000000-0000-0000-0000-000000000002';
  alice_member    uuid := '81000000-0000-0000-0000-000000000003';
  bob_user        uuid := '81000000-0000-0000-0000-000000000004';
  bob_member      uuid := '81000000-0000-0000-0000-000000000005';

  -- Shared and private accounts owned by Bob
  bob_shared_acc  uuid := '81000000-0000-0000-0000-000000000006';
  bob_priv_acc    uuid := '81000000-0000-0000-0000-000000000007';

  -- Bill assigned to Bob
  bob_bill        uuid := '81000000-0000-0000-0000-000000000008';

  -- Transactions
  tx1_id          uuid := '81000000-0000-0000-0000-000000000009';

  -- Household 2: For transfer ownership tests
  hh2_id          uuid := '82000000-0000-0000-0000-000000000001';
  owner2_user     uuid := '82000000-0000-0000-0000-000000000002';
  owner2_member   uuid := '82000000-0000-0000-0000-000000000003';
  partner2_user   uuid := '82000000-0000-0000-0000-000000000004';
  partner2_member uuid := '82000000-0000-0000-0000-000000000005';
begin
  insert into auth.users (id, email) values
    (alice_user, 'alice24@test.local'),
    (bob_user, 'bob24@test.local'),
    (owner2_user, 'owner2_24@test.local'),
    (partner2_user, 'partner2_24@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh1_id, 'HH1 Transfer & Remove', 'CL', 'CLP', 'America/Santiago'),
    (hh2_id, 'HH2 Transfer Only', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (alice_member, hh1_id, alice_user, 'owner', 'Alice'),
    (bob_member, hh1_id, bob_user, 'partner', 'Bob'),
    (owner2_member, hh2_id, owner2_user, 'owner', 'Owner 2'),
    (partner2_member, hh2_id, partner2_user, 'partner', 'Partner 2');

  insert into public.accounts (id, household_id, name, kind, currency, owner_member_id, is_shared) values
    (bob_shared_acc, hh1_id, 'Bob Shared Checking', 'checking', 'CLP', bob_member, true),
    (bob_priv_acc, hh1_id, 'Bob Private Savings', 'savings', 'CLP', bob_member, false);

  insert into public.bills (id, household_id, name, default_amount, currency, rrule, starts_on, responsible_member_id) values
    (bob_bill, hh1_id, 'Electricity Bill', 50000, 'CLP', 'FREQ=MONTHLY', current_date, bob_member);

  insert into public.transactions (id, household_id, account_id, amount, currency, occurred_on, description, entered_by, spent_by) values
    (tx1_id, hh1_id, bob_shared_acc, -12500, 'CLP', current_date, 'Groceries by Bob', bob_member, bob_member);
end
$$;

select plan(16);

-- ============================================================================
-- 1. transfer_ownership tests
-- ============================================================================

-- Partner cannot transfer ownership
select tests.authenticate_as('82000000-0000-0000-0000-000000000004', 'partner2_24@test.local');
select throws_ok(
  $$ select public.transfer_ownership('82000000-0000-0000-0000-000000000001'::uuid, '82000000-0000-0000-0000-000000000003'::uuid) $$,
  'P0001',
  'only active owners can transfer ownership',
  'partner cannot transfer ownership'
);

-- Owner can transfer ownership and demote self
select tests.authenticate_as('82000000-0000-0000-0000-000000000002', 'owner2_24@test.local');
select lives_ok(
  $$ select public.transfer_ownership('82000000-0000-0000-0000-000000000001'::uuid, '82000000-0000-0000-0000-000000000005'::uuid, true) $$,
  'owner transfers ownership and demotes self'
);

-- Verify Partner 2 is now owner, Owner 2 is now partner
select tests.clear_auth();
select results_eq(
  $$ select role from public.household_members where id = '82000000-0000-0000-0000-000000000005' $$,
  array['owner'::public.household_member_role],
  'Partner 2 promoted to owner'
);

select results_eq(
  $$ select role from public.household_members where id = '82000000-0000-0000-0000-000000000003' $$,
  array['partner'::public.household_member_role],
  'Owner 2 demoted to partner'
);

-- Constraint trigger blocks direct update that leaves 0 owners
select throws_ok(
  $$ update public.household_members set role = 'partner' where id = '82000000-0000-0000-0000-000000000005' $$,
  'P0001',
  'household must retain at least one active owner',
  'constraint trigger prevents zero active owners'
);

-- ============================================================================
-- 2. remove_member tests
-- ============================================================================

-- Partner (Bob) cannot remove anyone
select tests.authenticate_as('81000000-0000-0000-0000-000000000004', 'bob24@test.local');
select throws_ok(
  $$ select public.remove_member('81000000-0000-0000-0000-000000000001'::uuid, '81000000-0000-0000-0000-000000000003'::uuid) $$,
  'P0001',
  'only active owners can remove members',
  'partner cannot remove members'
);

-- Owner (Alice) attempting self-removal is rejected
select tests.authenticate_as('81000000-0000-0000-0000-000000000002', 'alice24@test.local');
select throws_ok(
  $$ select public.remove_member('81000000-0000-0000-0000-000000000001'::uuid, '81000000-0000-0000-0000-000000000003'::uuid) $$,
  'P0001',
  'owners cannot remove themselves; use transfer_ownership or leave_household',
  'owner self-removal directed to transfer or leave'
);

-- Owner removing non-existent or inactive member is rejected
select throws_ok(
  $$ select public.remove_member('81000000-0000-0000-0000-000000000001'::uuid, '81000000-0000-0000-0000-000000000099'::uuid) $$,
  'P0001',
  'target member not found or not active in this household',
  'removing non-existent member raises target member not found'
);
select throws_ok(
  $$ select public.remove_member('81000000-0000-0000-0000-000000000001'::uuid, '81000000-0000-0000-0000-000000000005'::uuid, '{}'::jsonb) $$,
  'P0001',
  'unresolved owned accounts',
  'removal with unresolved owned shared accounts rejected'
);

-- Record transaction byte representation before removal
create temp table tx_before as
select * from public.transactions where id = '81000000-0000-0000-0000-000000000009';

-- Remove Bob with disposition 'transfer' for Bob Shared Checking
select lives_ok(
  $$ select public.remove_member('81000000-0000-0000-0000-000000000001'::uuid, '81000000-0000-0000-0000-000000000005'::uuid, '{"81000000-0000-0000-0000-000000000006": "transfer"}'::jsonb) $$,
  'owner removes Bob with valid disposition'
);

-- Removing already removed member is an idempotent no-op
select lives_ok(
  $$ select public.remove_member('81000000-0000-0000-0000-000000000001'::uuid, '81000000-0000-0000-0000-000000000005'::uuid) $$,
  'removing an already removed member is an idempotent no-op'
);

select tests.clear_auth();

-- Verify Bob Shared Checking transferred to Alice
select results_eq(
  $$ select owner_member_id from public.accounts where id = '81000000-0000-0000-0000-000000000006' $$,
  array['81000000-0000-0000-0000-000000000003'::uuid],
  'Bob shared checking transferred to Alice'
);

-- Verify Bob private savings account was NOT touched (owner_member_id remains Bob)
select results_eq(
  $$ select owner_member_id from public.accounts where id = '81000000-0000-0000-0000-000000000007' $$,
  array['81000000-0000-0000-0000-000000000005'::uuid],
  'Bob private account untouched by removal'
);

-- Verify Bill reassigned to Alice
select results_eq(
  $$ select responsible_member_id from public.bills where id = '81000000-0000-0000-0000-000000000008' $$,
  array['81000000-0000-0000-0000-000000000003'::uuid],
  'Bill reassigned to Alice'
);

-- Verify transaction is byte-identical before and after
select results_eq(
  $$ select * from public.transactions where id = '81000000-0000-0000-0000-000000000009' $$,
  $$ select * from tx_before $$,
  'removed member transactions are byte-identical before and after removal'
);

-- Verify Alice (remaining member) can write/update the previously-owned shared account
select tests.authenticate_as('81000000-0000-0000-0000-000000000002', 'alice24@test.local');
select lives_ok(
  $$ update public.accounts set name = 'Transferred Checking' where id = '81000000-0000-0000-0000-000000000006' $$,
  'remaining member can write to previously-owned shared account'
);

rollback;
