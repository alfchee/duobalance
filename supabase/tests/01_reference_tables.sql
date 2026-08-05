-- Reference tables: currencies and fx_rates.
-- These are readable by any authenticated user (and are the only public-readable
-- data we expose). The tests confirm they're NOT writable by clients.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

-- Seed (we're postgres, RLS bypassed for setup). Idempotent: supabase/seed.sql
-- may have already inserted these on `db reset`.
insert into public.currencies (code, name, symbol, minor_unit) values
  ('CLP', 'Chilean peso',        '$',  0),
  ('USD', 'United States dollar','US$', 2),
  ('BRL', 'Brazilian real',      'R$', 2)
on conflict (code) do nothing;

insert into public.fx_rates (base_code, quote_code, as_of_date, rate) values
  ('USD', 'CLP', current_date, 950.00),
  ('USD', 'BRL', current_date, 5.10)
on conflict (base_code, quote_code, as_of_date) do nothing;

select plan(4);

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
  $$ select count(*)::int from public.fx_rates where base_code = 'USD' and quote_code = 'CLP' $$,
  $$ values (1::int) $$,
  'authenticated can read fx_rates'
);

-- 3. Authenticated cannot insert a currency (no policy = denied by RLS).
select throws_ok(
  $$ insert into public.currencies (code, name, symbol, minor_unit)
     values ('XXX', 'Test', 'X', 2) $$,
  '42501',  -- insufficient_privilege / RLS violation
  null,
  'authenticated cannot insert currencies (service-role only)'
);

-- 4. Authenticated cannot insert an fx_rate.
select throws_ok(
  $$ insert into public.fx_rates (base_code, quote_code, as_of_date, rate)
     values ('USD', 'EUR', current_date, 0.9) $$,
  '42501',
  null,
  'authenticated cannot insert fx_rates (service-role only)'
);

select * from finish();
rollback;
