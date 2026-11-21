-- Issue #264 (review follow-up): household_account_usage() must return the
-- same household-wide count the accounts_enforce_plan_limit trigger counts,
-- including private accounts the caller cannot see through RLS, and must
-- answer 0 for non-members so the definer helper cannot be probed across
-- households.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(3);

do $$
declare
  usr_a uuid := 'aaaaaaaa-0000-4000-8000-000000000032';
  usr_b uuid := 'bbbbbbbb-0000-4000-8000-000000000032';
  usr_outsider uuid := 'cccccccc-0000-4000-8000-000000000032';
  hh uuid := '10000000-0000-0000-0000-000000000032';
  hh_probe uuid := '10000000-0000-0000-0000-000000000098';
begin
  insert into auth.users (id, email) values
    (usr_a, 'usage-a@test.local'),
    (usr_b, 'usage-b@test.local'),
    (usr_outsider, 'usage-outsider@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh, 'Usage Count', 'CL', 'CLP', 'America/Santiago'),
    (hh_probe, 'Probe Target', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh, usr_a, 'owner', 'A'),
    (hh, usr_b, 'partner', 'B');

  -- 2 shared + 1 private owned by A + 1 private owned by B: every member
  -- sees 3 through RLS (account_balances is security_invoker), but the
  -- plan-limit trigger counts 4.
  insert into public.accounts (id, household_id, name, kind, currency, is_shared, owner_member_id, is_archived)
  values
    ('aaaaaaa0-0000-4000-8000-000000000031', hh, 'Shared 1', 'cash', 'CLP', true,  null, false),
    ('aaaaaaa0-0000-4000-8000-000000000032', hh, 'Shared 2', 'cash', 'CLP', true,  null, false),
    ('aaaaaaa0-0000-4000-8000-000000000033', hh, 'A private', 'cash', 'CLP', false,
      (select id from public.household_members where household_id = hh and user_id = usr_a), false),
    ('aaaaaaa0-0000-4000-8000-000000000034', hh, 'B private', 'cash', 'CLP', false,
      (select id from public.household_members where household_id = hh and user_id = usr_b), false);
end $$;

select tests.authenticate_as('aaaaaaaa-0000-4000-8000-000000000032', 'usage-a@test.local');

select is(
  public.household_account_usage('10000000-0000-0000-0000-000000000098'::uuid),
  0,
  'usage: a member of another household gets 0, not the count (probe closed)'
);

select is(
  public.household_account_usage('10000000-0000-0000-0000-000000000032'::uuid),
  4,
  'usage: owner sees the household-wide count including the other member''s private account'
);

select tests.authenticate_as('bbbbbbbb-0000-4000-8000-000000000032', 'usage-b@test.local');

select is(
  public.household_account_usage('10000000-0000-0000-0000-000000000032'::uuid),
  4,
  'usage: partner also sees the household-wide count'
);

select tests.clear_auth();
select * from finish();
