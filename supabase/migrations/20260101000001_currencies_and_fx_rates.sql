-- Reference data: ISO 4217 currencies and FX rates.
-- No foreign-key dependencies — must migrate first.

create table public.currencies (
  code        text        primary key,           -- ISO 4217, e.g. 'CLP', 'USD', 'BRL'
  name        text        not null,
  symbol      text        not null,
  minor_unit  smallint    not null check (minor_unit between 0 and 4),
  created_at  timestamptz not null default now()
);

comment on table  public.currencies          is 'ISO 4217 reference table. minor_unit drives keypad mask in #16.';
comment on column public.currencies.minor_unit is '0 for CLP/PYG, 2 for USD/EUR/BRL, 3 for KWD, 4 for UYW. Never derive from Intl for input.';

create table public.fx_rates (
  base_code    text         not null references public.currencies(code) on delete restrict,
  quote_code   text         not null references public.currencies(code) on delete restrict,
  as_of_date   date         not null,
  rate         numeric(20,10) not null check (rate > 0),
  source       text         not null default 'manual',
  created_at   timestamptz  not null default now(),
  primary key (base_code, quote_code, as_of_date)
);

create index fx_rates_lookup_idx
  on public.fx_rates (base_code, quote_code, as_of_date desc);

comment on table public.fx_rates is 'Daily FX rates. base→quote rate at as_of_date. Updated by cron job (Phase 1).';
