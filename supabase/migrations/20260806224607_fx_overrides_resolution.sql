-- Issue #18: household-level FX overrides + the two resolution functions that
-- every currency conversion in the app goes through.
--
-- Migration 10 created fx_overrides as a per-transaction design (one override
-- keyed on transaction_id). #18 supersedes it: the override is keyed on the
-- currency + date, not the transaction, because the point of an override is
-- "this currency's published rate is wrong, don't trust the feed for it" — a
-- statement about the *market*, not about one line item. The transaction keeps
-- its own fx_rate snapshot (migration 5); the override here supersedes it for
-- display.
--
-- Why overrides exist at all: ExchangeRate-API warns that ARS/VES published
-- rates diverge from rates actually obtainable in the market and defaults to
-- central-bank figures. A household that trades in those currencies needs a
-- manual correction. Overrides are also the "start manually, add the API
-- later" path — they resolve identically with or without the cron (#17).

-- ============================================================================
-- Drop the migration-10 design. Forward-only: this file is a deliberate
-- supersession, so DROP is the correct statement (the old shape is not
-- ALTER-able — different key, different columns). DROP cascades the
-- migration-11 grant + RLS policy + triggers; they are re-applied below.
-- ============================================================================

drop table public.fx_overrides;

create table public.fx_overrides (
  household_id  uuid          not null references public.households(id) on delete cascade,
  rate_date     date          not null,
  code          char(3)       not null references public.currencies(code),
  usd_rate      numeric(20,10) not null check (usd_rate > 0),
  note          text,
  primary key (household_id, rate_date, code)
);

comment on table  public.fx_overrides is 'Household-level manual FX correction. One row per (household, date, currency): usd_rate is "1 USD = usd_rate units of code". Wins outright over the global feed for that currency on or before rate_date.';
comment on column public.fx_overrides.usd_rate is '1 USD = usd_rate units of code, as the household says it is. Strictly positive.';
comment on column public.fx_overrides.note is 'Free-form reason for the override — visible in Settings so a stale override is explainable, not mysterious.';

-- ============================================================================
-- RLS + grants (re-applied after the DROP; mirrors migration 11's posture)
-- ============================================================================

alter table public.fx_overrides enable row level security;

create policy fx_overrides_all on public.fx_overrides
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

grant select, insert, update, delete on public.fx_overrides to anon, authenticated;
-- Anon holds the table grant but no RLS policy, so it gets 0 rows / blocked
-- writes — the standard Supabase broad-grant + RLS-boundary pattern.

-- ============================================================================
-- Resolution functions. SECURITY INVOKER (the default) on purpose: the data
-- they read — fx_overrides — is RLS-gated to household members, so the
-- caller's RLS context must apply. A SECURITY DEFINER variant here would let
-- any authenticated user resolve rates through another household's overrides.
-- ============================================================================

-- Resolve one leg to USD. An override wins OUTRIGHT whenever the household
-- has one on or before the date — not merely on ties. Rationale: setting any
-- override for a currency is an explicit statement of "don't trust the feed
-- for this one". If overrides only won on exact-date matches, tomorrow's
-- global rate would silently shadow the user's correction.
--
-- "on or before" also covers weekends/holidays, when no rate is published — a
-- Saturday transaction falls back to Friday rather than failing.
--
-- USD returns 1 before touching either table: the feed stores "1 USD = X
-- units of code" for every currency except USD itself (no row exists for the
-- base), so the USD leg of a cross-rate is identity, not a table lookup.
create or replace function public.fx_usd_rate(
  p_household uuid, p_date date, p_code char(3))
returns numeric
language plpgsql
stable
set search_path = public
as $$
begin
  if p_code = 'USD' then
    return 1;
  end if;
  return coalesce(
    (select usd_rate from public.fx_overrides
       where household_id = p_household and code = p_code and rate_date <= p_date
       order by rate_date desc limit 1),
    (select usd_rate from public.fx_rates
       where code = p_code and rate_date <= p_date
       order by rate_date desc limit 1)
  );
end;
$$;

-- Cross-rate between two currencies, routed through USD. Returns exactly 1 for
-- a same-currency call without touching either table. Raises a descriptive
-- exception when either leg is unresolvable rather than returning null — a
-- silent null would surface as a missing conversion mid-report.
create or replace function public.fx_rate_on(
  p_household uuid, p_date date, p_from char(3), p_to char(3))
returns numeric
language plpgsql
stable
set search_path = public
as $$
declare
  r_from numeric;
  r_to   numeric;
begin
  if p_from = p_to then
    return 1;
  end if;
  r_from := public.fx_usd_rate(p_household, p_date, p_from);
  r_to   := public.fx_usd_rate(p_household, p_date, p_to);
  if r_from is null or r_to is null then
    raise exception 'no FX rate for % → % on or before %', p_from, p_to, p_date;
  end if;
  -- 1 FROM = (1/r_from) USD = (r_to/r_from) TO
  return r_to / r_from;
end;
$$;

-- Callable via PostgREST RPC by the client (read-only, RLS-gated). Explicit
-- grants keep the surface deliberate; no SECURITY DEFINER here so no PUBLIC
-- narrowing is needed.
grant execute on function public.fx_usd_rate(uuid, date, char) to authenticated;
grant execute on function public.fx_rate_on(uuid, date, char, char) to authenticated;
