-- Issue #11: country_defaults reference table + the households
-- timezone/locale defaulting trigger. Readable by authenticated, not
-- writable by clients, and drives the one #11 acceptance criterion that
-- wasn't covered by the Phase 0 scaffold (migrations 2/3).

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(6);

-- Setup (we're postgres, RLS bypassed).
insert into public.currencies (code, name_en, symbol, minor_unit) values
  ('CLP', 'Chilean peso', '$', 0),
  ('BRL', 'Brazilian real', 'R$', 2)
on conflict (code) do nothing;

-- 1. Country known, both timezone/locale omitted: both derived.
insert into public.households (id, name, country, base_currency)
values ('10000000-0000-0000-0000-000000000001', 'Auto BR', 'BR', 'BRL');

select results_eq(
  $$ select timezone, locale from public.households
     where id = '10000000-0000-0000-0000-000000000001' $$,
  $$ values ('America/Sao_Paulo'::text, 'pt-BR'::text) $$,
  'BR household gets America/Sao_Paulo / pt-BR when omitted'
);

-- 2. Explicit values always win over the country default.
insert into public.households (id, name, country, base_currency, timezone, locale)
values ('10000000-0000-0000-0000-000000000002', 'Explicit CL', 'CL', 'CLP', 'America/Santiago', 'en');

select results_eq(
  $$ select locale from public.households
     where id = '10000000-0000-0000-0000-000000000002' $$,
  $$ values ('en'::text) $$,
  'explicit locale is not overridden by the country default'
);

-- 3. Partial override: timezone given, locale omitted — only locale is derived.
insert into public.households (id, name, country, base_currency, timezone)
values ('10000000-0000-0000-0000-000000000003', 'Partial CL', 'CL', 'CLP', 'America/Punta_Arenas');

select results_eq(
  $$ select timezone, locale from public.households
     where id = '10000000-0000-0000-0000-000000000003' $$,
  $$ values ('America/Punta_Arenas'::text, 'es'::text) $$,
  'explicit timezone kept, locale still derived from country'
);

-- 4. Unknown country with no explicit timezone: fails loud (no guess),
--    per CLAUDE.md — timezone is load-bearing for date-boundary math.
select throws_ok(
  $$ insert into public.households (id, name, country, base_currency)
     values ('10000000-0000-0000-0000-000000000004', 'Unknown', 'ZZ', 'CLP') $$,
  '23502',  -- not_null_violation
  null,
  'unknown country with no explicit timezone fails rather than guessing'
);

-- Switch to authenticated for RLS checks.
select tests.authenticate_as('00000000-0000-0000-0000-000000000bbb');

-- 5. Authenticated can read country_defaults.
select results_eq(
  $$ select count(*)::int from public.country_defaults where country = 'CL' $$,
  $$ values (1::int) $$,
  'authenticated can read country_defaults'
);

-- 6. Authenticated cannot insert into country_defaults (service-role only).
select throws_ok(
  $$ insert into public.country_defaults (country, timezone, locale)
     values ('ZZ', 'UTC', 'en') $$,
  '42501',
  null,
  'authenticated cannot insert country_defaults (service-role only)'
);

select * from finish();
rollback;
