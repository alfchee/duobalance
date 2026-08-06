-- Issue #12: create_household / accept_invite RPCs and the is_owner helper.
-- Both RPCs are SECURITY DEFINER specifically to cross the bootstrap
-- deadlock (you need to be a member to insert a member row); this file
-- checks both the happy paths and that the escape hatch is as narrow as
-- the spec requires.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

-- Reference data create_household's country-defaults trigger (migration 13)
-- needs; idempotent in case seed.sql hasn't run in this environment.
insert into public.currencies (code, name_en, symbol, minor_unit) values
  ('CLP', 'Chilean peso', '$', 0)
on conflict (code) do nothing;

insert into public.country_defaults (country, timezone, locale) values
  ('CL', 'America/Santiago', 'es')
on conflict (country) do nothing;

-- Fixture household + owner, used as the target of the invite tests below.
do $$
declare
  hh_id     uuid := '55555555-5555-5555-5555-555555555555';
  owner_id  uuid := 'e1e1e1e1-1111-1111-1111-111111111111';
  member_id uuid := 'e2e2e2e2-2222-2222-2222-222222222222';
begin
  insert into auth.users (id, email) values (owner_id, 'owner12@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_id, 'Invite House', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (member_id, hh_id, owner_id, 'owner', 'Owner');

  -- A second member of hh_id, role partner, used only to exercise is_owner()
  -- and the households_update policy below (distinct from the invite flow).
  insert into auth.users (id, email) values
    ('e8e8e8e8-8888-8888-8888-888888888888', 'partner12@test.local');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_id, 'e8e8e8e8-8888-8888-8888-888888888888', 'partner', 'Partner');

  insert into auth.users (id, email) values
    ('e3e3e3e3-3333-3333-3333-333333333333', 'expired@test.local'),
    ('e4e4e4e4-4444-4444-4444-444444444444', 'accepted@test.local'),
    ('e5e5e5e5-5555-5555-5555-555555555555', 'mismatch@test.local'),
    ('e6e6e6e6-6666-6666-6666-666666666666', 'valid@test.local'),
    ('e7e7e7e7-7777-7777-7777-777777777777', 'newowner@test.local');

  insert into public.household_invites
    (household_id, email, token, role, invited_by, expires_at, accepted_at) values
    (hh_id, 'expired@test.local',  'token-expired',  'partner', member_id, now() - interval '1 day', null),
    (hh_id, 'accepted@test.local', 'token-accepted', 'partner', member_id, now() + interval '7 days', now() - interval '1 hour'),
    (hh_id, 'mismatch@test.local', 'token-mismatch', 'partner', member_id, now() + interval '7 days', null),
    (hh_id, 'valid@test.local',    'token-valid',    'partner', member_id, now() + interval '7 days', null);

  -- A disabled currency for the create_household rejection test below
  -- (migration 17). Inserted here in the superuser `do` block because
  -- `currencies` is RLS-locked to read-only for data-API roles.
  insert into public.currencies (code, name_en, symbol, minor_unit, is_enabled) values
    ('XXX', 'Disabled fixture', '$', 2, false)
  on conflict (code) do update set is_enabled = false;
end
$$;

select plan(21);

-- ============================================================================
-- is_owner helper — direct behavior checks, not just "it exists".
-- ============================================================================

select tests.authenticate_as('e1e1e1e1-1111-1111-1111-111111111111');

select ok(
  ( select public.is_owner('55555555-5555-5555-5555-555555555555') ),
  'is_owner is true for the household owner'
);

select tests.authenticate_as('e8e8e8e8-8888-8888-8888-888888888888');

select ok(
  ( select not public.is_owner('55555555-5555-5555-5555-555555555555') ),
  'is_owner is false for a partner (member, not owner)'
);

select tests.authenticate_as('e3e3e3e3-3333-3333-3333-333333333333');

select ok(
  ( select not public.is_owner('55555555-5555-5555-5555-555555555555') ),
  'is_owner is false for a non-member'
);

-- ============================================================================
-- households_update — now backed by is_owner() instead of an inlined
-- subquery (migration 11 -> altered here). Regression check that the swap
-- didn't change who can update a household.
-- ============================================================================

select tests.authenticate_as('e8e8e8e8-8888-8888-8888-888888888888');

select results_eq(
  $$ with updated as (
       update public.households set name = 'Pwned'
         where id = '55555555-5555-5555-5555-555555555555'
         returning 1
     )
     select count(*)::int from updated $$,
  $$ values (0::int) $$,
  'partner UPDATE on households: 0 rows (is_owner denies non-owners)'
);

select tests.authenticate_as('e1e1e1e1-1111-1111-1111-111111111111');

select results_eq(
  $$ with updated as (
       update public.households set name = 'Renamed'
         where id = '55555555-5555-5555-5555-555555555555'
         returning 1
     )
     select count(*)::int from updated $$,
  $$ values (1::int) $$,
  'owner UPDATE on households: 1 row (is_owner allows the owner)'
);

-- ============================================================================
-- create_household
-- ============================================================================

select tests.authenticate_as('e7e7e7e7-7777-7777-7777-777777777777', 'newowner@test.local');

select isnt(
  ( select public.create_household('New House', 'CL', 'CLP', 'New Owner') ),
  null,
  'create_household returns a new household id'
);

select results_eq(
  $$ select count(*)::int from public.household_members
     where user_id = 'e7e7e7e7-7777-7777-7777-777777777777'
       and role = 'owner' $$,
  $$ values (1::int) $$,
  'create_household made the caller the owner member'
);

-- households has no INSERT policy: a direct INSERT is denied by RLS,
-- and pg_policies confirms no such policy exists at all.
select throws_ok(
  $$ insert into public.households (name, country, base_currency, timezone)
     values ('Sneaky House', 'CL', 'CLP', 'America/Santiago') $$,
  '42501',
  null,
  'direct INSERT into households is denied (RLS, no policy)'
);

select results_eq(
  $$ select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'households' and cmd = 'INSERT' $$,
  $$ values (0::int) $$,
  'households has zero INSERT policies'
);

-- anon has no execute grant on create_household at all.
select tests.authenticate_anon();

select throws_ok(
  $$ select public.create_household('Anon House', 'CL', 'CLP', 'Anon') $$,
  '42501',
  null,
  'anon cannot call create_household (no EXECUTE grant)'
);

-- Migration 17 hardening: create_household rejects a base currency whose
-- is_enabled flag is false. The disabled 'XXX' code is seeded in the fixture
-- block above (before any authenticate_as, i.e. as the superuser) — `currencies`
-- is read-only under RLS for the data-API roles, so inserting it as the
-- authenticated 'newowner' user below would be denied. CLP from the fixture
-- stays enabled and is the happy path already exercised by 'New House'.
select tests.authenticate_as('e7e7e7e7-7777-7777-7777-777777777777', 'newowner@test.local');

select throws_ok(
  $$ select public.create_household('Bad Currency House', 'CL', 'XXX', 'Owner') $$,
  'P0001',
  'base currency is not enabled',
  'create_household rejects a disabled base currency'
);

-- ============================================================================
-- accept_invite
-- ============================================================================

select tests.authenticate_as('e3e3e3e3-3333-3333-3333-333333333333', 'expired@test.local');

select throws_ok(
  $$ select public.accept_invite('token-expired') $$,
  'P0001',
  'invite expired',
  'accept_invite rejects an expired token'
);

select tests.authenticate_as('e4e4e4e4-4444-4444-4444-444444444444', 'accepted@test.local');

select throws_ok(
  $$ select public.accept_invite('token-accepted') $$,
  'P0001',
  'invite already accepted',
  'accept_invite rejects an already-accepted token'
);

select tests.authenticate_as('e5e5e5e5-5555-5555-5555-555555555555', 'someone-else@test.local');

select throws_ok(
  $$ select public.accept_invite('token-mismatch') $$,
  'P0001',
  'invite email does not match authenticated user',
  'accept_invite rejects an email mismatch'
);

select tests.authenticate_as('e6e6e6e6-6666-6666-6666-666666666666', 'valid@test.local');

select results_eq(
  $$ select public.accept_invite('token-valid') $$,
  $$ values ('55555555-5555-5555-5555-555555555555'::uuid) $$,
  'accept_invite returns the invite household_id'
);

select results_eq(
  $$ select role::text from public.household_members
     where household_id = '55555555-5555-5555-5555-555555555555'
       and user_id = 'e6e6e6e6-6666-6666-6666-666666666666' $$,
  $$ values ('partner'::text) $$,
  'accept_invite created a partner member row'
);

select results_eq(
  $$ select count(*)::int from public.household_invites
     where token = 'token-valid' and accepted_at is not null $$,
  $$ values (1::int) $$,
  'accept_invite stamped accepted_at'
);

-- Already a member now: re-accepting must fail (unique violation on
-- household_members, surfaced rather than silently swallowed).
select throws_ok(
  $$ select public.accept_invite('token-valid') $$,
  'P0001',
  'invite already accepted',
  'accept_invite rejects re-use of an already-accepted token'
);

-- anon has no execute grant on accept_invite either.
select tests.authenticate_anon();

select throws_ok(
  $$ select public.accept_invite('token-valid') $$,
  '42501',
  null,
  'anon cannot call accept_invite (no EXECUTE grant)'
);

-- ============================================================================
-- SECURITY DEFINER scope: only these two are, everything mutation-shaped
-- goes through SECURITY INVOKER + RLS.
-- ============================================================================

select results_eq(
  $$ select prosecdef from pg_proc
     where proname = 'create_household' and pronamespace = 'public'::regnamespace $$,
  $$ values (true) $$,
  'create_household is SECURITY DEFINER'
);

select results_eq(
  $$ select prosecdef from pg_proc
     where proname = 'accept_invite' and pronamespace = 'public'::regnamespace $$,
  $$ values (true) $$,
  'accept_invite is SECURITY DEFINER'
);

select * from finish();
rollback;
