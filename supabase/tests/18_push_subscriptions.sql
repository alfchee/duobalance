\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(4);

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

select * from finish();
rollback;
