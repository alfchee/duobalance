-- Issue #29: budgets table (per-month, per-category, optional owner) +
-- budget_status view with mandatory `security_invoker = on`.
--
-- Replaces the Phase 1 budgets table (migrations 6 & 23) which used
-- a `period` enum + `starts_on` model. The new design:
--   * period_month (date) — constrained to month-start
--   * amount in household base currency (no separate currency column)
--   * owner_member_id: null = household/joint budget, set = that member's
--     personal budget
--   * No is_active: deactivate-by-delete or by creating a replacement row
--     for the same month
--   * row-level rollover (when a new month's budget inherits the prior
--     month's unspent amount)
--
-- The view uses `security_invoker = on` (PG15+). Without it the view runs
-- with the owner's privileges and would BYPASS RLS, exposing every household's
-- budgets and private spending to any authenticated caller.

-- ============================================================================
-- 1. Teardown old Phase-1 budgets infrastructure
-- ============================================================================

drop view if exists public.budget_status;

drop trigger if exists budgets_match_household_base_currency on public.budgets;
drop trigger if exists households_preserve_budget_currency on public.households;
drop function if exists public.tg_budgets_match_household_base_currency;
drop function if exists public.tg_households_preserve_budget_currency;

drop table if exists public.budgets;

drop type if exists public.budget_period;

-- ============================================================================
-- 2. New budgets table
-- ============================================================================

create table public.budgets (
  id              uuid        primary key default gen_random_uuid(),
  household_id    uuid        not null references public.households(id) on delete cascade,
  category_id     uuid        not null references public.categories(id) on delete cascade,
  period_month    date        not null,
  amount          numeric(18,4) not null check (amount >= 0),

  -- null => household/joint budget; set => that member's personal budget
  owner_member_id uuid        references public.household_members(id) on delete cascade,

  rollover        boolean     not null default false,

  constraint budgets_period_is_month_start
    check (period_month = date_trunc('month', period_month)::date)
);

comment on table public.budgets is
  'Monthly budget per (household, category, optional member). Amount is in household base currency.';

comment on column public.budgets.owner_member_id is
  'null = household/joint budget; non-null = personal budget for that member';
comment on column public.budgets.rollover is
  'When true, unspent amount from the prior month carries forward into the current month';

-- Two partial indexes: NULL does not deduplicate in a plain unique constraint.
create unique index budgets_household_uniq
  on public.budgets (household_id, category_id, period_month)
  where owner_member_id is null;

create unique index budgets_member_uniq
  on public.budgets (household_id, category_id, period_month, owner_member_id)
  where owner_member_id is not null;

comment on index public.budgets_household_uniq is
  'One household budget per category+month (owner_member_id IS NULL)';
comment on index public.budgets_member_uniq is
  'One personal budget per member+category+month';

-- ============================================================================
-- 3. budget_status view — security_invoker is mandatory (see issue #29 body
--    for the full reasoning: the default owner-privileges execution model
--    bypasses RLS and exposes every household's budgets).
-- ============================================================================

create or replace view public.budget_status
with (security_invoker = on) as
select
  b.id,
  b.household_id,
  b.category_id,
  b.period_month,
  b.amount,
  b.owner_member_id,
  b.rollover,
  coalesce(sum(-t.base_amount), 0)            as spent,
  b.amount - coalesce(sum(-t.base_amount), 0) as remaining
from public.budgets b
left join public.transactions t
  on  t.household_id  = b.household_id
  and t.category_id   = b.category_id
  and date_trunc('month', t.occurred_on)::date = b.period_month
  and t.transfer_group_id is null           -- exclude transfers
  and t.amount < 0                          -- expenses only
  and (b.owner_member_id is null
       or t.spent_by = b.owner_member_id)   -- personal budget: only that member's spending
group by b.id;

comment on view public.budget_status is
  'Monthly budget vs. actuals. Spent = sum of expense (negative) base_amounts in the period, excluding transfers. Household budgets sum across all members; personal budgets filter by spent_by. security_invoker=on ensures RLS is not bypassed.';

comment on column public.budget_status.spent is
  'Total spending in household base currency for this budget period. Transfers and income (positive amounts) are excluded.';
comment on column public.budget_status.remaining is
  'budgeted - spent. Can be negative when overspent (no clamping).';

-- ============================================================================
-- 4. RLS policies
-- ============================================================================

alter table public.budgets enable row level security;

-- SELECT: members of the household can see its budgets
create policy budgets_select on public.budgets
  for select to authenticated
  using (public.is_member(household_id));

-- INSERT: members can create household (null owner) or their own personal
-- budgets, but not one owned by their partner
create policy budgets_insert on public.budgets
  for insert to authenticated
  with check (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
  );

-- UPDATE: same gate as INSERT — can update household budgets or your own
create policy budgets_update on public.budgets
  for update to authenticated
  using (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
  )
  with check (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
  );

-- DELETE: same gate
create policy budgets_delete on public.budgets
  for delete to authenticated
  using (
    public.is_member(household_id)
    and (owner_member_id is null
         or owner_member_id = public.current_member_id(household_id))
  );

-- ============================================================================
-- 5. Grants (same posture as every other table: full DML for both roles,
--    RLS is the actual gate)
-- ============================================================================

grant select, insert, update, delete on public.budgets to anon, authenticated;
grant select on public.budget_status to anon, authenticated;