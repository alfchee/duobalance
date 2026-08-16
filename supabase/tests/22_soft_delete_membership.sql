-- #118: soft-delete membership schema foundation. A removed member (or a
-- member of a soft-deleted household) must lose all read/write access via
-- active_membership, while their history (old rows, past transactions)
-- stays intact and check_member_in_household stays a pure containment check.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_id           uuid := '61000000-0000-0000-0000-000000000001';
  owner_user      uuid := '61000000-0000-0000-0000-000000000002';
  owner_member    uuid := '61000000-0000-0000-0000-000000000003';
  removed_user    uuid := '61000000-0000-0000-0000-000000000004';
  removed_member  uuid := '61000000-0000-0000-0000-000000000005';
  acct_id         uuid := '61000000-0000-0000-0000-000000000006';
  tx_id           uuid := '61000000-0000-0000-0000-000000000007';
  invite_reinvite uuid := '61000000-0000-0000-0000-000000000008';
  invite_owner_dup uuid := '61000000-0000-0000-0000-000000000009';
  hh2_id          uuid := '62000000-0000-0000-0000-000000000001';
  hh2_user        uuid := '62000000-0000-0000-0000-000000000002';
  hh2_member      uuid := '62000000-0000-0000-0000-000000000003';
begin
  insert into auth.users (id, email) values
    (owner_user, 'owner118@test.local'),
    (removed_user, 'removed118@test.local'),
    (hh2_user, 'hh2member118@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_id, 'Soft Delete House', 'CL', 'CLP', 'America/Santiago'),
    (hh2_id, 'Already Gone House', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_member, hh_id, owner_user, 'owner', 'Owner'),
    (removed_member, hh_id, removed_user, 'partner', 'Removed Partner'),
    (hh2_member, hh2_id, hh2_user, 'owner', 'HH2 Owner');

  -- Soft-remove the partner.
  update public.household_members
    set removed_at = now(), removed_by = owner_member, removal_reason = 'removed'
    where id = removed_member;

  -- A pre-existing transaction attributed to the now-removed member — this
  -- must remain editable by other members (check_member_in_household must
  -- not filter on removed_at).
  insert into public.accounts (id, household_id, name, kind, currency) values
    (acct_id, hh_id, 'Shared checking', 'checking', 'CLP');

  insert into public.transactions
    (id, household_id, account_id, amount, currency, occurred_on, description, entered_by)
  values
    (tx_id, hh_id, acct_id, -1000, 'CLP', current_date, 'Old expense by removed member', removed_member);

  -- A second household, soft-deleted outright.
  update public.households set deleted_at = now() where id = hh2_id;

  -- A fresh (unaccepted) invite so the removed partner can be re-invited.
  insert into public.household_invites (id, household_id, email, token, role, invited_by) values
    (invite_reinvite, hh_id, 'removed118@test.local', 'reinvite-token-118', 'partner', owner_member);

  -- A second invite for the owner, who is already an active member of hh_id —
  -- used to assert accept_invite rejects a redundant active membership.
  insert into public.household_invites (id, household_id, email, token, role, invited_by) values
    (invite_owner_dup, hh_id, 'owner118@test.local', 'owner-dup-token-118', 'partner', owner_member);
end
$$;

select plan(15);

-- ============================================================================
-- As the removed partner: every read empty, every write blocked.
-- ============================================================================
select tests.authenticate_as('61000000-0000-0000-0000-000000000004', 'removed118@test.local');

select is_empty(
  $$ select * from public.household_members $$,
  'removed member sees no household_members rows'
);

select is_empty(
  $$ select * from public.transactions $$,
  'removed member sees no transactions'
);

select ok(
  not public.is_member('61000000-0000-0000-0000-000000000001'::uuid),
  'is_member() returns false for a removed member'
);

-- INSERT always attempts the write, so a failing WITH CHECK raises (42501) —
-- current_member_id() is null for a removed member, so entered_by can never
-- match it.
select throws_ok(
  $$ insert into public.transactions
       (household_id, account_id, amount, currency, occurred_on, description, entered_by)
     values (
       '61000000-0000-0000-0000-000000000001',
       '61000000-0000-0000-0000-000000000006',
       -500, 'CLP', current_date, 'sneaky',
       '61000000-0000-0000-0000-000000000005'
     ) $$,
  '42501',
  null,
  'removed member cannot INSERT a transaction'
);

-- UPDATE's USING clause silently excludes the row (same mechanism as a
-- removed member's SELECT returning empty) rather than raising — 0 rows
-- affected is the correct, expected shape here.
select results_eq(
  $$ with updated as (
       update public.transactions set description = 'hacked'
         where id = '61000000-0000-0000-0000-000000000007'
         returning 1
     ) select count(*)::int from updated $$,
  $$ values (0::int) $$,
  'removed member UPDATE on transaction: 0 rows (RLS blocks)'
);

-- ============================================================================
-- As the active owner: recursion guard + editing a removed member's history.
-- ============================================================================
select tests.authenticate_as('61000000-0000-0000-0000-000000000002', 'owner118@test.local');

-- Regression guard for the SECURITY DEFINER recursion this pattern exists to
-- avoid: is_member() must return normally for a normal, active caller.
select ok(
  public.is_member('61000000-0000-0000-0000-000000000001'::uuid),
  'is_member() returns true for the active owner without a stack-depth error'
);

select lives_ok(
  $$ select public.check_member_in_household(
       '61000000-0000-0000-0000-000000000005'::uuid,
       '61000000-0000-0000-0000-000000000001'::uuid
     ) $$,
  'check_member_in_household() does not filter on removed_at (pure containment check)'
);

-- Updating spent_by fires the containment trigger (before update of ...
-- spent_by), which must still succeed for a removed member.
select results_eq(
  $$ with updated as (
       update public.transactions
         set description = 'edited by owner', spent_by = '61000000-0000-0000-0000-000000000005'
         where id = '61000000-0000-0000-0000-000000000007'
         returning 1
     ) select count(*)::int from updated $$,
  $$ values (1::int) $$,
  'owner can edit a transaction attributed to a removed member'
);

-- ============================================================================
-- Member of a soft-deleted household: no access, via the same helper.
-- ============================================================================
select tests.authenticate_as('62000000-0000-0000-0000-000000000002', 'hh2member118@test.local');

select ok(
  not public.is_member('62000000-0000-0000-0000-000000000001'::uuid),
  'member of a soft-deleted household has no access via is_member()'
);

select is_empty(
  $$ select * from public.households where id = '62000000-0000-0000-0000-000000000001' $$,
  'member of a soft-deleted household cannot see the household row'
);

-- ============================================================================
-- Re-invite: the removed partner regains access via a new row; history stays.
-- ============================================================================
select tests.authenticate_as('61000000-0000-0000-0000-000000000004', 'removed118@test.local');

select results_eq(
  $$ select public.accept_invite('reinvite-token-118') $$,
  $$ values ('61000000-0000-0000-0000-000000000001'::uuid) $$,
  'removed member accepts a fresh invite and rejoins'
);

select results_eq(
  $$ select count(*)::int from public.household_members
     where household_id = '61000000-0000-0000-0000-000000000001'
       and user_id = '61000000-0000-0000-0000-000000000004'
       and removed_at is null $$,
  $$ values (1::int) $$,
  'exactly one active membership row exists after re-invite'
);

select results_eq(
  $$ select count(*)::int from public.household_members
     where household_id = '61000000-0000-0000-0000-000000000001'
       and user_id = '61000000-0000-0000-0000-000000000004' $$,
  $$ values (2::int) $$,
  'the old removed row is preserved alongside the new one (history intact)'
);

select ok(
  public.is_member('61000000-0000-0000-0000-000000000001'::uuid),
  're-invited member regains access (is_member() true again)'
);

-- ============================================================================
-- accept_invite rejects a redundant active membership.
-- ============================================================================
select tests.authenticate_as('61000000-0000-0000-0000-000000000002', 'owner118@test.local');

select throws_ok(
  $$ select public.accept_invite('owner-dup-token-118') $$,
  'P0001',
  'you already have an active membership in this household',
  'accept_invite rejects a token for a household the caller is already active in'
);

select * from finish();
rollback;
