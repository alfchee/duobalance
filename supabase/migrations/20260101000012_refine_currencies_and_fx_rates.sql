-- Issue #10 refinement: align currencies + fx_rates with the spec.
--
-- What changes vs. migration 1:
--   1. currencies.name   → currencies.name_en  (i18n prep; #16 adds name_es, etc.)
--   2. currencies.symbol becomes nullable  (some currencies have no canonical glyph)
--   3. currencies.code  text  →  char(3)      (ISO 4217 is fixed-width)
--   4. currencies.minor_unit gains a default of 2
--   5. currencies gains an is_enabled column (hide unsupported codes without losing rows)
--   6. fx_rates switches from a base/quote pair to a USD-based model:
--        one rate per (rate_date, code) expressing "1 USD = usd_rate units of code"
--      which is what ExchangeRate-API returns in a single call. Anything non-USD
--      is derived by division: X units of code_a → code_b is X * (rate_b / rate_a)
--      at the same rate_date.
--
-- Migrations 1 and 11 still hold the original design as historical record; the
-- fx_rates table is dropped because the semantic change (base/quote → USD-based)
-- is not expressible as an ALTER. RLS, policies, and grants are re-applied to the
-- recreated table.

-- ============================================================================
-- currencies
-- ============================================================================

alter table public.currencies
  alter column code type char(3),
  alter column symbol drop not null,
  alter column minor_unit set default 2;

-- name → name_en, but only if the old column still exists. Forward-only safety:
-- if this migration is ever re-applied (e.g. a tooling accident) we don't blow up.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'currencies'
      and column_name  = 'name'
  ) then
    alter table public.currencies rename column name to name_en;
  end if;
end
$$;

alter table public.currencies
  add column is_enabled boolean not null default true;

create index currencies_enabled_idx
  on public.currencies (code) where is_enabled;

comment on column public.currencies.name_en   is 'English name. Localized names (name_es, etc.) land in #16.';
comment on column public.currencies.is_enabled is 'False hides the code from the household-base-currency picker without losing the row.';

-- ============================================================================
-- fx_rates — drop and recreate
-- ============================================================================

drop table public.fx_rates;

create table public.fx_rates (
  rate_date   date             not null,
  code        char(3)          not null references public.currencies(code) on delete restrict,
  usd_rate    numeric(20,10)   not null check (usd_rate > 0),
  source      text             not null default 'exchangerate-api',
  fetched_at  timestamptz      not null default now(),
  primary key (rate_date, code)
);

create index fx_rates_code_date_idx
  on public.fx_rates (code, rate_date desc);

comment on table  public.fx_rates               is 'Daily USD-based FX rates from ExchangeRate-API. 1 USD = usd_rate units of `code`. Cross rates are derived: X units of a → b is X * (rate_b / rate_a) at the same rate_date.';
comment on column public.fx_rates.usd_rate     is '1 USD = usd_rate units of `code`. Always strictly positive — the check rejects 0 and negative.';
comment on column public.fx_rates.source       is 'Provider identifier. Free-form today, "exchangerate-api" is the only one used in Phase 0.';

-- ============================================================================
-- RLS, policies, grants — recreation is required because DROP TABLE cascaded them.
-- ============================================================================

alter table public.fx_rates enable row level security;

create policy fx_rates_read on public.fx_rates
  for select to authenticated using (true);

grant select on public.fx_rates to anon, authenticated;
grant select on public.currencies to anon, authenticated;
