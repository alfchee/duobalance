-- Seed reference data. Applied after migrations by `supabase db reset`
-- (and `supabase start` on a fresh DB). Idempotent: safe to re-run.
--
-- Issue #10 requires all Americas codes from the spec, with `minor_unit = 0`
-- for CLP and PYG and `= 2` for everything else. ExchangeRate-API is the
-- upstream source; this list mirrors the codes it returns today (and which
-- the issue requires for the Americas). Codes come and go — keep this in
-- sync with the provider's supported-codes response on every refactor.

insert into public.currencies (code, name_en, symbol, minor_unit) values
  -- Americas (per issue #10)
  ('USD', 'United States dollar',         'US$', 2),
  ('CAD', 'Canadian dollar',              'CA$', 2),
  ('MXN', 'Mexican peso',                 '$',   2),
  ('GTQ', 'Guatemalan quetzal',           'Q',   2),
  ('BZD', 'Belize dollar',                'BZ$', 2),
  ('CRC', 'Costa Rican colón',            '₡',   2),
  ('SVC', 'Salvadoran colón',             '₡',   2),
  ('HNL', 'Honduran lempira',             'L',   2),
  ('NIO', 'Nicaraguan córdoba',           'C$',  2),
  ('PAB', 'Panamanian balboa',            'B/.', 2),
  ('CUP', 'Cuban peso',                   '$',   2),
  ('DOP', 'Dominican peso',               'RD$', 2),
  ('HTG', 'Haitian gourde',               'G',   2),
  ('JMD', 'Jamaican dollar',              'J$',  2),
  ('TTD', 'Trinidad and Tobago dollar',   'TT$', 2),
  ('BBD', 'Barbadian dollar',             'Bds$',2),
  ('BSD', 'Bahamian dollar',              'B$',  2),
  ('XCD', 'East Caribbean dollar',        'EC$', 2),
  ('AWG', 'Aruban florin',                'Afl.',2),
  ('SRD', 'Surinamese dollar',            'Sr$', 2),
  ('GYD', 'Guyanese dollar',              'G$',  2),
  ('COP', 'Colombian peso',               'Col$',2),
  ('VES', 'Venezuelan bolívar soberano',  'Bs.S',2),
  ('BRL', 'Brazilian real',               'R$',  2),
  ('PEN', 'Peruvian sol',                 'S/',  2),
  ('BOB', 'Bolivian boliviano',           'Bs',  2),
  ('CLP', 'Chilean peso',                 '$',   0),  -- minor_unit = 0
  ('ARS', 'Argentine peso',               '$',   2),
  ('PYG', 'Paraguayan guaraní',           '₲',   0),  -- minor_unit = 0
  ('UYU', 'Uruguayan peso',               '$U',  2),
  ('KYD', 'Cayman Islands dollar',        'CI$', 2),
  ('BMD', 'Bermudian dollar',             'BD$', 2),

  -- Major non-Americas currencies (kept from the original seed)
  ('EUR', 'Euro',                         '€',   2),
  ('GBP', 'Pound sterling',               '£',   2)
on conflict (code) do nothing;

-- Issue #11: sensible timezone/locale defaults per household country. Best
-- effort — most of these countries span one dominant timezone (capital
-- city's zone). locale is constrained to {es, en, pt-BR} per
-- architecture-conventions; countries whose primary language isn't one of
-- those three get the closest of the three, not a guess outside the set.
insert into public.country_defaults (country, timezone, locale) values
  ('US', 'America/New_York',               'en'),
  ('CA', 'America/Toronto',                'en'),
  ('MX', 'America/Mexico_City',            'es'),
  ('GT', 'America/Guatemala',              'es'),
  ('BZ', 'America/Belize',                 'en'),
  ('CR', 'America/Costa_Rica',             'es'),
  ('SV', 'America/El_Salvador',            'es'),
  ('HN', 'America/Tegucigalpa',            'es'),
  ('NI', 'America/Managua',                'es'),
  ('PA', 'America/Panama',                 'es'),
  ('CU', 'America/Havana',                 'es'),
  ('DO', 'America/Santo_Domingo',          'es'),
  ('HT', 'America/Port-au-Prince',         'en'),
  ('JM', 'America/Jamaica',                'en'),
  ('TT', 'America/Port_of_Spain',          'en'),
  ('BB', 'America/Barbados',               'en'),
  ('BS', 'America/Nassau',                 'en'),
  ('AW', 'America/Aruba',                  'es'),
  ('SR', 'America/Paramaribo',             'en'),
  ('GY', 'America/Guyana',                 'en'),
  ('CO', 'America/Bogota',                 'es'),
  ('VE', 'America/Caracas',                'es'),
  ('BR', 'America/Sao_Paulo',              'pt-BR'),
  ('PE', 'America/Lima',                   'es'),
  ('BO', 'America/La_Paz',                 'es'),
  ('CL', 'America/Santiago',               'es'),
  ('AR', 'America/Argentina/Buenos_Aires', 'es'),
  ('PY', 'America/Asuncion',               'es'),
  ('UY', 'America/Montevideo',             'es'),
  ('KY', 'America/Cayman',                 'en'),
  ('BM', 'America/Bermuda',                'en'),
  ('ES', 'Europe/Madrid',                  'es'),
  ('GB', 'Europe/London',                  'en')
on conflict (country) do nothing;
