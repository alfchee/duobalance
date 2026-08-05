-- One-off FX overrides on transactions. The transaction stores the rate it
-- was created with (transactions.fx_rate); an override here supersedes it
-- for display. A user-overridden rate never silently reverts.

create table public.fx_overrides (
  id                  uuid          primary key default gen_random_uuid(),
  household_id        uuid          not null references public.households(id) on delete cascade,
  transaction_id      uuid          not null references public.transactions(id) on delete cascade,
  original_rate       numeric(20,10) not null check (original_rate > 0),
  original_currency   text          not null references public.currencies(code) on delete restrict,
  override_rate       numeric(20,10) not null check (override_rate > 0),
  reason              text,
  overridden_by       uuid          not null references public.household_members(id) on delete restrict,
  overridden_at       timestamptz   not null default now(),
  unique (transaction_id)  -- one active override per transaction
);

create index fx_overrides_household_idx   on public.fx_overrides (household_id);
create index fx_overrides_transaction_idx on public.fx_overrides (transaction_id);

comment on table public.fx_overrides is 'When the user picks a different FX rate than the one the system suggested. The display layer prefers this rate over transactions.fx_rate.';
