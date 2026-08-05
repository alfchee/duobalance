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
