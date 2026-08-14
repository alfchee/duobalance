-- Issue #17: fx_fetch_log run-outcome audit table. The cron handler writes it
-- with the service role; these tests prove it accepts runs, enforces the
-- outcome enum, and stays closed to the data API.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(15);

-- ============================================================================
-- Shape: rows accept a run outcome with counts, reject unknown outcomes.
-- Runs as the postgres superuser (service-role equivalent).
-- ============================================================================

select lives_ok(
  $$ insert into public.fx_fetch_log (fetch_date, status, currencies_updated)
     values ('2026-08-06', 'success', 30) $$,
  'a success run with updated currency count is accepted'
);

select results_eq(
  $$ select fetch_date::text, status, currencies_updated
     from public.fx_fetch_log order by fetched_at desc limit 1 $$,
  $$ values ('2026-08-06', 'success', 30::int) $$,
  'the inserted run is readable back'
);

select throws_ok(
  $$ insert into public.fx_fetch_log (fetch_date, status)
     values ('2026-08-06', 'bogus') $$,
  '23514',
  null,
  'an unknown outcome is rejected by the check constraint'
);

select lives_ok(
  $$ insert into public.fx_fetch_log (fetch_date, status, error)
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
  $$ insert into public.fx_fetch_log (fetch_date, status)
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

select tests.clear_auth();

select lives_ok(
  $$ select public.claim_fx_refresh('2026-08-07') $$,
  'the first refresh claim succeeds'
);

select results_eq(
  $$ select public.claim_fx_refresh('2026-08-07') $$,
  $$ values (false) $$,
  'a same-day refresh claim is skipped'
);

select results_eq(
  $$ select count(*)::int from public.fx_fetch_log
     where fetch_date = '2026-08-07' and status = 'skipped' $$,
  $$ values (1::int) $$,
  'a skipped claim is logged'
);

select results_eq(
  $$ select public.record_fx_refresh_success('2026-08-07', 3) $$,
  $$ values (true) $$,
  'the first success is recorded'
);

select set_config('role', 'service_role', true);

select results_eq(
  $$ select public.claim_fx_refresh('2026-08-08') $$,
  $$ values (true) $$,
  'service_role can claim a refresh date'
);

select lives_ok(
  $$ select public.record_fx_refresh_failure('2026-08-08', 'provider unavailable') $$,
  'service_role can record a failure and release its refresh claim'
);

select results_eq(
  $$ select public.claim_fx_refresh('2026-08-08') $$,
  $$ values (true) $$,
  'service_role can reclaim a date after a failed refresh'
);

select * from finish();
rollback;
