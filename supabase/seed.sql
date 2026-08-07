-- Reference-data seeds applied by `supabase db reset` (the project also runs
-- these via a CI step that invokes `supabase db seed` after migrations).
-- Keeps the country/currency pickers populated in fresh dev/CI databases.
--
-- Must stay idempotent with INSERT ... ON CONFLICT DO NOTHING: migration
-- 20260807170000_seed_latam_countries_currencies.sql writes the same rows so
-- pre-existing deployments (which never re-run the seed) still get data.
--
-- Keep this list in sync with the migration above. CI's pg_prove tests rely
-- on the country_defaults rows to create test households via
-- fixtures.create_household_for.

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
  ('US', 'America/New_York',                 'en'),
  ('ES', 'Europe/Madrid',                    'es')
on conflict (country) do nothing;

insert into public.currencies (code, name_en, symbol, minor_unit, is_enabled) values
  ('ARS', 'Argentine Peso',        '$',    2, true),
  ('BOB', 'Bolivian Boliviano',    'Bs',   2, true),
  ('BRL', 'Brazilian Real',        'R$',   2, true),
  ('CLP', 'Chilean Peso',          '$',    0, true),
  ('COP', 'Colombian Peso',        '$',    0, true),
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
  ('USD', 'US Dollar',             '$',    2, true),
  ('EUR', 'Euro',                  '€',    2, true)
on conflict (code) do nothing;
