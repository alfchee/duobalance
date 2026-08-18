\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

insert into public.currencies (code, name_en, symbol, minor_unit) values
  ('CLP', 'Chilean peso', '$', 0)
on conflict (code) do nothing;

insert into public.country_defaults (country, timezone, locale) values
  ('CL', 'America/Santiago', 'es')
on conflict (country) do nothing;

do $$
declare
  user_id uuid := 'f1f1f1f1-1111-1111-1111-111111111111';
  index int;
begin
  insert into auth.users (id, email) values (user_id, 'cap@test.local');
  for index in 1..5 loop
    insert into public.households (name, country, base_currency, timezone)
    values ('House ' || index, 'CL', 'CLP', 'America/Santiago');
    insert into public.household_members (household_id, user_id, role, display_name)
    select id, user_id, 'owner', 'Cap User'
    from public.households
    where name = 'House ' || index;
  end loop;
end
$$;

-- A second household + owner, used to invite the cap user once they're
-- already at the cap (tests that accept_invite enforces it too).
do $$
declare
  inviter_user   uuid := 'f2f2f2f2-2222-2222-2222-222222222222';
  inviter_member uuid;
  inviter_house  uuid;
begin
  insert into auth.users (id, email) values (inviter_user, 'inviter@test.local');
  insert into public.households (name, country, base_currency, timezone)
  values ('Inviter House', 'CL', 'CLP', 'America/Santiago')
  returning id into inviter_house;
  insert into public.household_members (household_id, user_id, role, display_name)
  values (inviter_house, inviter_user, 'owner', 'Inviter')
  returning id into inviter_member;
  insert into public.household_invites (household_id, email, token, role, invited_by)
  values (inviter_house, 'cap@test.local', 'cap-invite-token', 'partner', inviter_member);
end
$$;

select plan(5);
select tests.authenticate_as('f1f1f1f1-1111-1111-1111-111111111111', 'cap@test.local');

select results_eq(
  $$ select count(*)::int
     from pg_get_functiondef('public.create_household(text, text, text, text, text, text, text)'::regprocedure)
     where pg_get_functiondef('public.create_household(text, text, text, text, text, text, text)'::regprocedure)
       like '%from auth.users%for update%' $$,
  $$ values (1::int) $$,
  'create_household locks (for update) the authenticated user before counting memberships'
);

select throws_ok(
  $$ select public.create_household('One Too Many', 'CL', 'CLP', 'Cap User') $$,
  'P0001',
  'household limit reached',
  'create_household limits a user to five active households'
);

select throws_ok(
  $$ select public.accept_invite('cap-invite-token') $$,
  'P0001',
  'household limit reached',
  'accept_invite also enforces the five-household cap'
);

-- Leaving a household the user solely owns soft-deletes it (delegates to
-- delete_household) and must free the creation-cap slot immediately.
select lives_ok(
  $$ select public.leave_household(
       (select household_id from public.household_members
        where user_id = 'f1f1f1f1-1111-1111-1111-111111111111'
          and removed_at is null
        order by joined_at limit 1)
     ) $$,
  'owner leaves a household with no other members (delegates to delete_household)'
);

select lives_ok(
  $$ select public.create_household('Reclaimed Slot', 'CL', 'CLP', 'Cap User') $$,
  'deleting a household frees the creation-cap slot (cap counts active_membership)'
);

select * from finish();
rollback;
