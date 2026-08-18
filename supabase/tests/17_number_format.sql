\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
begin
  insert into auth.users (id, email) values
    ('18181818-1818-1818-1818-181818181818', 'number-owner@test.local'),
    ('19191919-1919-1919-1919-191919191919', 'number-partner@test.local');
end
$$;

select plan(11);

select tests.authenticate_as('18181818-1818-1818-1818-181818181818');
select is_empty(
  $$ select * from public.user_preferences $$,
  'a missing row represents the default preferences'
);
select lives_ok(
  $$ insert into public.user_preferences (user_id, number_format, locale)
     values ('18181818-1818-1818-1818-181818181818', 'dot_decimal', 'en') $$,
  'a user can create their own preference row'
);
select results_eq(
  $$ select number_format, locale from public.user_preferences $$,
  $$ values ('dot_decimal'::text, 'en'::text) $$,
  'the user preference stores number format and locale together'
);
select lives_ok(
  $$ update public.user_preferences set number_format = 'comma_decimal' $$,
  'a user can update their own preference row'
);
select throws_ok(
  $$ update public.user_preferences set number_format = 'invalid' $$,
  '23514',
  null,
  'invalid number formats are rejected by the constraint'
);

select tests.authenticate_as('19191919-1919-1919-1919-191919191919');
select is_empty(
  $$ select * from public.user_preferences $$,
  'another user cannot read the preference row'
);
select lives_ok(
  $$ update public.user_preferences set locale = 'pt-BR'
     where user_id = '18181818-1818-1818-1818-181818181818' $$,
  'another user cannot update the preference row'
);
select tests.clear_auth();
select results_eq(
  $$ select locale from public.user_preferences
     where user_id = '18181818-1818-1818-1818-181818181818' $$,
  $$ values ('en'::text) $$,
  'an unauthorized update leaves the preference unchanged'
);
select tests.authenticate_as('19191919-1919-1919-1919-191919191919');
select throws_ok(
  $$ insert into public.user_preferences (user_id, locale)
     values ('18181818-1818-1818-1818-181818181818', 'es') $$,
  '42501',
  null,
  'another user cannot create a preference row on their behalf'
);
select results_eq(
  $$ with deleted as (
       delete from public.user_preferences
         where user_id = '18181818-1818-1818-1818-181818181818'
         returning 1
     )
     select count(*)::int from deleted $$,
  $$ values (0::int) $$,
  'another user cannot delete the preference row (RLS blocks)'
);

select tests.authenticate_as('18181818-1818-1818-1818-181818181818');
select results_eq(
  $$ with deleted as (
       delete from public.user_preferences
         where user_id = '18181818-1818-1818-1818-181818181818'
         returning 1
     )
     select count(*)::int from deleted $$,
  $$ values (1::int) $$,
  'a user can delete their own preference row'
);

select * from finish();
rollback;
