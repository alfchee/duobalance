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

select plan(1);
select tests.authenticate_as('f1f1f1f1-1111-1111-1111-111111111111', 'cap@test.local');

select throws_ok(
  $$ select public.create_household('One Too Many', 'CL', 'CLP', 'Cap User') $$,
  'P0001',
  'household limit reached',
  'create_household limits a user to five active households'
);

select * from finish();
rollback;
