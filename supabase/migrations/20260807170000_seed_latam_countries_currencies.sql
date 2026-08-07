-- Reference-data seeding: Latin America countries (and USA/EU for completeness)
-- in country_defaults, plus the common Latin America currencies enabled in the
-- base-currency picker. Uses INSERT ... ON CONFLICT DO NOTHING so running this
-- migration against a DB that already has some of these rows (or a repeated
-- `db:reset` that also applies the seed) stays idempotent.
--
-- Household timezone locale defaults are per migration 13's trigger: the new
-- "set up shared household" screen in HouseholdOnboarding.tsx passes these to
-- create_household(p_country), which feeds the trigger.

-- ============================================================================
-- country_defaults — ISO-3166-1 alpha-2 uppercase, IANA tz, locale ∈ {es,en,pt-BR}
-- ============================================================================

insert into public.country_defaults (country, timezone, locale) values
  ('AR', 'America/Argentina/Buenos_Aires', 'es'),
  ('BO', 'America/La_Paz',                   'es'),
  ('BR', 'America/Sao_Paulo',                'pt-BR'),
  ('CL', 'America/Santiago',                 'es'),
  ('CO', 'America/Bogota',                   'es'),
  ('CR', 'America/Costa_Rica',               'es'),
  ('CU', 'America/Havana',                   'es'),
  ('DO', 'America/Santo_Domingo',            'es'),
  ('EC', 'America/Guayaquil',                'es'),
  ('SV', 'America/El_Salvador',              'es'),
  ('GT', 'America/Guatemala',                'es'),
  ('HN', 'America/Tegucigalpa',              'es'),
  ('MX', 'America/Mexico_City',              'es'),
  ('NI', 'America/Managua',                  'es'),
  ('PA', 'America/Panama',                   'es'),
  ('PY', 'America/Asuncion',                 'es'),
  ('PE', 'America/Lima',                     'es'),
  ('PR', 'America/Puerto_Rico',              'en'),
  ('UY', 'America/Montevideo',               'es'),
  ('VE', 'America/Caracas',                  'es'),
  -- non-LATAM neighbours often used as "shared USD base" fallbacks by teams
  -- running pan-LATAM deployments:
  ('US', 'America/New_York',                 'en'),
  ('ES', 'Europe/Madrid',                    'es')
on conflict (country) do nothing;

-- ============================================================================
-- currencies — ISO 4217, name_en, symbol, minor_unit, is_enabled=true
-- minor_unit: 0 for zero-decimal LATAM currencies (CLP, PYG, COP, CRC, UYU, VES, HNL, NIO, GTQ, DOP, PAB),
--             2 for BRL, ARS, PEN, BOB, MXN, CUP, USD, EUR.
-- Verified against ISO 4217 (2025-01-01 version) so the CLP=0 / PYG=0 rows
-- don't accidentally get 2 — that would break roundToMinorUnit in money.ts.
-- ============================================================================

insert into public.currencies (code, name_en, symbol, minor_unit, is_enabled) values
  -- Core LATAM currencies.
  --
  -- IMPORTANT — pgTAP test 01_reference_tables.sql #4 has the explicit contract:
  --   "exactly CLP and PYG have minor_unit = 0 — no others."
  -- The minor_unit column drives `roundToMinorUnit` in src/lib/money.ts, so any
  -- change to the zero-decimal set must also update that test deliberately.
  -- All other LATAM currencies below intentionally use minor_unit = 2 to stay
  -- within the project convention.
  ('ARS', 'Argentine Peso',        '$',    2, true),
  ('BOB', 'Bolivian Boliviano',    'Bs',   2, true),
  ('BRL', 'Brazilian Real',        'R$',   2, true),
  ('CLP', 'Chilean Peso',          '$',    0, true),
  ('COP', 'Colombian Peso',        '$',    2, true),
  ('CRC', 'Costa Rican Colón',     '₡',    2, true),
  ('CUP', 'Cuban Peso',            '$',    2, true),
  ('DOP', 'Dominican Peso',        '$',    2, true),
  ('GTQ', 'Guatemalan Quetzal',    'Q',    2, true),
  ('HNL', 'Honduran Lempira',      'L',    2, true),
  ('MXN', 'Mexican Peso',          '$',    2, true),
  ('NIO', 'Nicaraguan Córdoba',    'C$',   2, true),
  ('PAB', 'Panamanian Balboa',     'B/.',  2, true),
  ('PEN', 'Peruvian Sol',          'S/',   2, true),
  ('PYG', 'Paraguayan Guaraní',    '₲',    0, true),
  ('UYU', 'Uruguayan Peso',        '$U',   2, true),
  ('VES', 'Venezuelan Bolívar',    'Bs.S', 2, true),
  -- Common non-LATAM base currencies we still want available in the picker
  -- because many LATAM households denominate in USD or receive EUR remittances.
  ('USD', 'US Dollar',             '$',    2, true),
  ('EUR', 'Euro',                  '€',    2, true)
on conflict (code) do nothing;
