-- Issue #17: fx_fetch_log run-outcome audit table. The cron + manual refresh
-- handlers write it with the service role; these tests prove it accepts runs,
-- enforces the outcome enum, and stays closed to the data API.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(8);

-- ============================================================================
-- Shape: rows accept a run outcome with counts, reject unknown outcomes.
-- Runs as the postgres superuser (service-role equivalent).
-- ============================================================================

select lives_ok(
  $$ insert into public.fx_fetch_log (rate_date, outcome, inserted, updated, skipped)
     values ('2026-08-06', 'success', 30, 4, 2) $$,
  'a success run with counts is accepted'
);

select results_eq(
  $$ select rate_date::text, outcome, inserted, updated, skipped
     from public.fx_fetch_log order by ran_at desc limit 1 $$,
  $$ values ('2026-08-06', 'success', 30::int, 4::int, 2::int) $$,
  'the inserted run is readable back'
);

select throws_ok(
  $$ insert into public.fx_fetch_log (rate_date, outcome)
     values ('2026-08-06', 'bogus') $$,
  '23514',
  null,
  'an unknown outcome is rejected by the check constraint'
);

select lives_ok(
  $$ insert into public.fx_fetch_log (rate_date, outcome, error)
     values ('2026-08-06', 'failed', 'provider returned HTTP 500') $$,
  'a failed run with an error message is accepted'
);

-- ============================================================================
-- Closed to the data API: anon/authenticated have no grant.
-- ============================================================================

select tests.authenticate_as('e0e0e0e0-0000-0000-0000-000000000000');

select throws_ok(
  $$ select count(*) from public.fx_fetch_log $$,
  '42501',
  null,
  'authenticated has no SELECT grant on fx_fetch_log'
);

select throws_ok(
  $$ insert into public.fx_fetch_log (rate_date, outcome)
     values ('2026-08-06', 'success') $$,
  '42501',
  null,
  'authenticated has no INSERT grant on fx_fetch_log'
);

select tests.authenticate_anon();

select throws_ok(
  $$ select count(*) from public.fx_fetch_log $$,
  '42501',
  null,
  'anon has no SELECT grant on fx_fetch_log'
);

-- ============================================================================
-- RLS is enabled with zero policies — a defense-in-depth assertion in case a
-- future grant widens access.
-- ============================================================================

select results_eq(
  $$ select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'fx_fetch_log' $$,
  $$ values (0::int) $$,
  'fx_fetch_log has zero RLS policies'
);

select * from finish();
rollback;
