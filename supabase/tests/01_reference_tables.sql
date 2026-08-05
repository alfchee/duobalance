-- Reference tables: currencies and fx_rates.
-- Readable by any authenticated user; anon is denied (RLS policy is
-- `to authenticated` only — see 04_anon_denied.sql for the anon-side
-- assertion). Not writable by clients either way. The spec's load-bearing
-- checks here: write policies do NOT exist, and `check (usd_rate > 0)`
-- rejects zero and negative rates.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

-- Seed (we're postgres, RLS bypassed for setup). Idempotent: supabase/seed.sql
-- may have already inserted these on `db reset`.
insert into public.currencies (code, name_en, symbol, minor_unit) values
  ('CLP', 'Chilean peso',        '$',  0),
  ('USD', 'United States dollar','US$', 2),
  ('BRL', 'Brazilian real',      'R$', 2)
on conflict (code) do nothing;

insert into public.fx_rates (rate_date, code, usd_rate) values
  (current_date, 'CLP', 950.00),
  (current_date, 'BRL',   5.10)
on conflict (rate_date, code) do nothing;

select plan(8);

-- Switch to authenticated
select tests.authenticate_as('00000000-0000-0000-0000-000000000aaa');

-- 1. Authenticated can read currencies.
select results_eq(
  $$ select count(*)::int from public.currencies where code = 'CLP' $$,
  $$ values (1::int) $$,
  'authenticated can read currencies'
);

-- 2. Authenticated can read fx_rates.
select results_eq(
  $$ select count(*)::int from public.fx_rates where code = 'CLP' $$,
  $$ values (1::int) $$,
  'authenticated can read fx_rates'
);

-- 3. CLP and PYG have minor_unit = 0 (the only two zero-decimal currencies per spec).
select results_eq(
  $$ select minor_unit from public.currencies where code in ('CLP','PYG') order by code $$,
  $$ values (0::smallint), (0::smallint) $$,
  'CLP and PYG have minor_unit = 0'
);

-- 4. The set of zero-decimal currencies is exactly {CLP, PYG} — no others.
--    This is the load-bearing seed assertion: if a new zero-decimal code is
--    added in supabase/seed.sql, this test forces a deliberate update here.
select results_eq(
  $$ select code::text from public.currencies where minor_unit = 0 order by code $$,
  $$ values ('CLP'), ('PYG') $$,
  'exactly CLP and PYG have minor_unit = 0'
);

-- 5. Authenticated cannot insert a currency (no policy = denied by RLS).
select throws_ok(
  $$ insert into public.currencies (code, name_en, symbol, minor_unit)
     values ('XXX', 'Test', 'X', 2) $$,
  '42501',  -- insufficient_privilege / RLS violation
  null,
  'authenticated cannot insert currencies (service-role only)'
);

-- 6. Authenticated cannot insert an fx_rate.
select throws_ok(
  $$ insert into public.fx_rates (rate_date, code, usd_rate)
     values (current_date, 'EUR', 0.9) $$,
  '42501',
  null,
  'authenticated cannot insert fx_rates (service-role only)'
);

-- 7. check (usd_rate > 0) rejects 0 and negative.
--    Back to postgres (RLS bypassed) so we exercise the constraint directly.
select tests.clear_auth();
select throws_ok(
  $$ insert into public.fx_rates (rate_date, code, usd_rate)
     values (current_date, 'EUR', 0) $$,
  '23514',  -- check_violation
  null,
  'fx_rates rejects usd_rate = 0'
);

select throws_ok(
  $$ insert into public.fx_rates (rate_date, code, usd_rate)
     values (current_date, 'EUR', -0.5) $$,
  '23514',
  null,
  'fx_rates rejects usd_rate < 0'
);

select * from finish();
rollback;
