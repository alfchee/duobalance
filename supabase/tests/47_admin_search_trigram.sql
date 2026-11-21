-- Admin household search trigram support (code-review follow-up on #272):
-- the GIN trigram index backing leading-wildcard ILIKE on households(name)
-- exists, and the admin search still matches by name fragment.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh_m       uuid := 'e7000000-0000-0000-0000-000000000001';
  owner_m    uuid := 'e7000000-0000-0000-0000-000000000011';
  admin_user uuid := 'e7000000-0000-0000-0000-000000000020';
begin
  insert into auth.users (id, email) values
    (owner_m, 'cpm47@test.local'),
    (admin_user, 'admin47@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh_m, 'Trigram Casa Norte 47', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (household_id, user_id, role, display_name) values
    (hh_m, owner_m, 'owner', 'Trigram 47');

  insert into public.admin_users (user_id, role, note) values
    (admin_user, 'billing', 'test admin 47');
end
$$;

select plan(2);

-- 1. The trigram index exists on households(name).
select results_eq(
  $$ select count(*)::int from pg_indexes
      where schemaname = 'public'
        and tablename = 'households'
        and indexname = 'households_name_trgm_idx' $$,
  $$ values (1) $$,
  'households_name_trgm_idx exists'
);

-- 2. Name-fragment search still resolves through the admin reader.
select tests.authenticate_as('e7000000-0000-0000-0000-000000000020');

select results_eq(
  $$ select household_name from public.admin_list_households('casa norte', null, 10, 0) $$,
  $$ values ('Trigram Casa Norte 47'::text) $$,
  'leading-fragment name search matches'
);

select tests.clear_auth();
select * from finish();
