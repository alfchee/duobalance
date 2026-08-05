-- A household is the tenancy boundary. Every other table joins back to one of these.
-- Depends on currencies (base_currency FK).

create type public.household_member_role as enum ('owner', 'partner');

create table public.households (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null check (char_length(name) between 1 and 80),
  country         text        not null check (char_length(country) = 2),  -- ISO 3166-1 alpha-2
  base_currency   text        not null references public.currencies(code) on delete restrict,
  timezone        text        not null,                                  -- IANA, e.g. 'America/Santiago'
  locale          text        not null default 'es' check (locale in ('es', 'en', 'pt-BR')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index households_created_at_idx on public.households (created_at desc);

comment on column public.households.country is 'ISO 3166-1 alpha-2. Drives date/number formatting defaults.';
comment on column public.households.timezone is 'IANA timezone. Used by todayInHousehold() in #16.';
