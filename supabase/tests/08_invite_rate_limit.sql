-- Issue #15: invite email rate limiting. The cap lives in a trigger on
-- invite_sends so it holds even across serverless cold starts; these tests
-- prove the cap, the window, and that the table is closed to the data API.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

-- Fixture user. invite_sends references auth.users, so create one.
insert into auth.users (id, email) values
  ('e0e0e0e0-0000-0000-0000-000000000000', 'ratelimit@test.local');

select plan(9);

-- ============================================================================
-- The cap: 10 sends within an hour are allowed, the 11th is rejected.
-- Runs as the postgres superuser (service-role equivalent) — the trigger
-- fires for any inserter.
-- ============================================================================

do $$
declare
  i int;
begin
  for i in 1..10 loop
    insert into public.invite_sends (user_id)
    values ('e0e0e0e0-0000-0000-0000-000000000000');
  end loop;
end
$$;

select results_eq(
  $$ select count(*)::int from public.invite_sends
     where user_id = 'e0e0e0e0-0000-0000-0000-000000000000' $$,
  $$ values (10::int) $$,
  '10 send rows are accepted within the window'
);

select throws_ok(
  $$ insert into public.invite_sends (user_id)
     values ('e0e0e0e0-0000-0000-0000-000000000000') $$,
  'P0001',
  'invite rate limit exceeded',
  'the 11th send within the hour raises'
);

-- ============================================================================
-- The window: a send older than an hour doesn't count against the cap.
-- The trigger prunes rows older than 24h, so simulate age by shifting the
-- existing rows back 2 hours, then the 11th insert should succeed.
-- ============================================================================

update public.invite_sends
set sent_at = sent_at - interval '2 hours'
where user_id = 'e0e0e0e0-0000-0000-0000-000000000000';

select lives_ok(
  $$ insert into public.invite_sends (user_id)
     values ('e0e0e0e0-0000-0000-0000-000000000000') $$,
  'a send is allowed once the window slides past an hour'
);

-- ============================================================================
-- Pruning: rows older than 24h are deleted by the trigger on insert.
-- ============================================================================

update public.invite_sends
set sent_at = sent_at - interval '25 hours'
where user_id = 'e0e0e0e0-0000-0000-0000-000000000000';

select lives_ok(
  $$ insert into public.invite_sends (user_id)
     values ('e0e0e0e0-0000-0000-0000-000000000000') $$,
  'an insert still succeeds after old rows accumulate'
);

select results_eq(
  $$ select count(*)::int from public.invite_sends
     where user_id = 'e0e0e0e0-0000-0000-0000-000000000000'
       and sent_at > now() - interval '24 hours' $$,
  $$ values (1::int) $$,
  'the trigger pruned rows older than 24h, keeping only the fresh insert'
);

-- ============================================================================
-- No grants: anon/authenticated cannot touch invite_sends at all. The data
-- API roles have no grant (migration 11's grant list omits it), so even
-- without RLS policies they get "permission denied" before any policy runs.
-- ============================================================================

select tests.authenticate_as('e0e0e0e0-0000-0000-0000-000000000000');

select throws_ok(
  $$ select count(*) from public.invite_sends $$,
  '42501',
  null,
  'authenticated has no SELECT grant on invite_sends'
);

select throws_ok(
  $$ insert into public.invite_sends (user_id)
     values ('e0e0e0e0-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'authenticated has no INSERT grant on invite_sends'
);

select tests.authenticate_anon();

select throws_ok(
  $$ select count(*) from public.invite_sends $$,
  '42501',
  null,
  'anon has no SELECT grant on invite_sends'
);

-- ============================================================================
-- RLS is enabled but carries zero policies — a defense in depth assertion
-- in case a future grant widens access.
-- ============================================================================

select results_eq(
  $$ select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'invite_sends' $$,
  $$ values (0::int) $$,
  'invite_sends has zero RLS policies'
);

select * from finish();
rollback;
