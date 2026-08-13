\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(9);

select has_table('public', 'push_subscriptions', 'push subscriptions table exists');
select has_column('public', 'push_subscriptions', 'endpoint', 'push subscriptions have endpoints');
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_all'),
  1,
  'push subscriptions have an RLS policy'
);

select tests.authenticate_anon();

select throws_ok(
  $$ insert into public.push_subscriptions (household_id, member_id, endpoint, p256dh, auth)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'https://push.example/subscription', 'key', 'auth') $$,
  '42501',
  null,
  'anon cannot create push subscriptions'
);

select tests.clear_auth();

do $$
declare
  household_id uuid := '18000000-0000-0000-0000-000000000001';
  first_user_id uuid := '18100000-0000-0000-0000-000000000001';
  second_user_id uuid := '18100000-0000-0000-0000-000000000002';
begin
  insert into auth.users (id, email) values
    (first_user_id, 'push-first@test.local'),
    (second_user_id, 'push-second@test.local');
  insert into public.households (id, name, country, base_currency, timezone)
    values (household_id, 'Push Test', 'NI', 'USD', 'America/Managua');
  insert into public.household_members (id, household_id, user_id, role, display_name) values
    ('18200000-0000-0000-0000-000000000001', household_id, first_user_id, 'owner', 'First'),
    ('18200000-0000-0000-0000-000000000002', household_id, second_user_id, 'partner', 'Second');
end
$$;

select tests.authenticate_as('18100000-0000-0000-0000-000000000001');

select lives_ok(
  $$ insert into public.push_subscriptions (household_id, member_id, endpoint, p256dh, auth)
     values ('18000000-0000-0000-0000-000000000001', '18200000-0000-0000-0000-000000000001', 'https://push.example/first', 'key', 'auth') $$,
  'member can create their own push subscription'
);

select is_empty(
  $$ select * from public.push_subscriptions where member_id = '18200000-0000-0000-0000-000000000002'::uuid $$,
  'member cannot view another member push subscription'
);

select throws_ok(
  $$ insert into public.push_subscriptions (household_id, member_id, endpoint, p256dh, auth)
     values ('18000000-0000-0000-0000-000000000001', '18200000-0000-0000-0000-000000000002', 'https://push.example/second', 'key', 'auth') $$,
  '42501',
  null,
  'member cannot create a push subscription for another member'
);

select tests.authenticate_as('18100000-0000-0000-0000-000000000002');

select results_eq(
  $$ with updated as (
       update public.push_subscriptions set auth = 'changed'
       where endpoint = 'https://push.example/first'
       returning 1
     ) select count(*)::integer from updated $$,
  $$ values (0::integer) $$,
  'member cannot update another member push subscription'
);

select results_eq(
  $$ with deleted as (
       delete from public.push_subscriptions
       where endpoint = 'https://push.example/first'
       returning 1
     ) select count(*)::integer from deleted $$,
  $$ values (0::integer) $$,
  'member cannot delete another member push subscription'
);

select * from finish();
rollback;
