-- Issue #11 gap-fill. Households, household_members, and household_invites
-- (tables, cascades, the owner/partner role check) already landed in
-- migrations 2 and 3 during the Phase 0 scaffold. Two pieces of the #11 spec
-- were still missing:
--   1. household_members.avatar_url / color_hex (per-person chart color)
--   2. households.timezone/locale defaulting from country when the caller
--      doesn't supply them — the one unmet acceptance criterion.

-- ============================================================================
-- household_members: remaining profile fields from the #11 spec
-- ============================================================================

alter table public.household_members
  add column avatar_url text,
  add column color_hex  text check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.household_members.color_hex is 'Per-person color for charts/UI, e.g. "#3B82F6". Nullable until the user picks one.';

-- ============================================================================
-- country_defaults: reference table driving household timezone/locale.
-- Same shape/RLS posture as currencies — read-only reference data.
-- ============================================================================

create table public.country_defaults (
  country   text not null primary key check (char_length(country) = 2),  -- ISO 3166-1 alpha-2
  timezone  text not null,                                                -- IANA
  locale    text not null check (locale in ('es', 'en', 'pt-BR'))
);

comment on table public.country_defaults is 'Seeds households.timezone/locale on insert when the caller omits them. Populated in supabase/seed.sql.';

alter table public.country_defaults enable row level security;

create policy country_defaults_read on public.country_defaults
  for select to authenticated using (true);

grant select on public.country_defaults to anon, authenticated;

-- ============================================================================
-- Trigger: fill households.timezone/locale from country_defaults when the
-- caller leaves them null. Explicit values always win — the trigger only
-- touches whichever of the two columns is still null when it fires. For a
-- country with no matching row, timezone is left null and the table's
-- `not null` constraint rejects the insert rather than guess wrong (see
-- CLAUDE.md: timezone is load-bearing for date-boundary math).
-- ============================================================================

-- The static default masked the difference between "caller didn't pass
-- locale" and "caller explicitly asked for es" — drop it so the trigger can
-- tell those apart and still fall back to es itself when needed.
alter table public.households
  alter column locale drop default;

create or replace function public.tg_household_country_defaults()
returns trigger
language plpgsql
as $$
declare
  d public.country_defaults;
begin
  if new.timezone is null or new.locale is null then
    select * into d from public.country_defaults where country = new.country;

    if new.timezone is null then
      new.timezone := d.timezone;
    end if;

    if new.locale is null then
      new.locale := coalesce(d.locale, 'es');
    end if;
  end if;

  return new;
end;
$$;

create trigger households_country_defaults
  before insert on public.households
  for each row execute function public.tg_household_country_defaults();
