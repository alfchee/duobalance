-- Seed reference data. Applied after migrations by `supabase db reset`
-- (and `supabase start` on a fresh DB). Idempotent: safe to re-run.

-- ISO 4217 currencies the app supports. Add more as the household
-- population grows; the `currencies` table has no ENUM, so a new row is
-- all that is needed.
insert into public.currencies (code, name, symbol, minor_unit) values
  ('CLP', 'Chilean peso',           '$',  0),
  ('ARS', 'Argentine peso',         '$',  2),
  ('BRL', 'Brazilian real',         'R$', 2),
  ('COP', 'Colombian peso',         '$',  2),
  ('MXN', 'Mexican peso',           '$',  2),
  ('PEN', 'Peruvian sol',           'S/', 2),
  ('UYU', 'Uruguayan peso',         '$U', 2),
  ('USD', 'United States dollar',   'US$', 2),
  ('EUR', 'Euro',                   '€',  2),
  ('GBP', 'Pound sterling',         '£',  2)
on conflict (code) do nothing;
