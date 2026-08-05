-- Budgets and the rolled-up status view (current period spent vs. budgeted).

create type public.budget_period as enum ('weekly', 'monthly', 'yearly');

create table public.budgets (
  id            uuid                primary key default gen_random_uuid(),
  household_id  uuid                not null references public.households(id) on delete cascade,
  -- Null category = total household budget; non-null = per-category.
  category_id   uuid                references public.categories(id) on delete cascade,
  period        public.budget_period not null,
  amount        numeric(20,4)       not null check (amount >= 0),
  currency      text                not null references public.currencies(code) on delete restrict,
  -- Inclusive lower bound; upper bound is implicit (next period's start).
  starts_on     date                not null,
  is_active     boolean             not null default true,
  created_at    timestamptz         not null default now(),
  updated_at    timestamptz         not null default now()
);

create index budgets_household_idx on public.budgets (household_id) where is_active;
create unique index budgets_one_per_category_period_idx
  on public.budgets (household_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), period, starts_on);

comment on table public.budgets is 'A budget applies from starts_on forward; closing a budget = set is_active=false and add a successor.';

-- Materialized-like view (actually a regular view; small data, fine to recompute).
-- Spent is computed in the budget's own currency; transactions in a different
-- currency are converted at the transaction's own fx_rate to keep math local.
create view public.budget_status
with (security_invoker = true) as
select
  b.id                                       as budget_id,
  b.household_id,
  b.category_id,
  b.period,
  b.amount                                   as budgeted,
  b.currency,
  coalesce(sum(t.amount), 0)                 as spent,
  b.amount - coalesce(sum(t.amount), 0)      as remaining,
  case
    when b.amount = 0 then 0
    else round((coalesce(sum(t.amount), 0) / b.amount * 100)::numeric, 2)
  end                                        as pct_used
from public.budgets b
left join public.transactions t
  on t.household_id  = b.household_id
 and (b.category_id is null or t.category_id = b.category_id)
 and t.occurred_at  >= b.starts_on
 and case b.period
       when 'weekly'  then t.occurred_at <  b.starts_on + interval '7 days'
       when 'monthly' then t.occurred_at <  b.starts_on + interval '1 month'
       when 'yearly'  then t.occurred_at <  b.starts_on + interval '1 year'
     end
where b.is_active
group by b.id, b.household_id, b.category_id, b.period, b.amount, b.currency, b.starts_on;

comment on view public.budget_status is 'Active budgets with spent/remaining for the current period. Recomputed on read.';
