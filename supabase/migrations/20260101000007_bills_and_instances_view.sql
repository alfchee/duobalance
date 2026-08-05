-- Recurring bills and their per-period instances. The view joins them for the UI.

create type public.bill_frequency as enum ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly');

create table public.bills (
  id              uuid                  primary key default gen_random_uuid(),
  household_id    uuid                  not null references public.households(id) on delete cascade,
  name            text                  not null check (char_length(name) between 1 and 80),
  amount          numeric(20,4)         not null check (amount > 0),
  currency        text                  not null references public.currencies(code) on delete restrict,
  account_id      uuid                  not null references public.accounts(id) on delete restrict,
  category_id     uuid                  references public.categories(id) on delete set null,
  frequency       public.bill_frequency not null,
  -- Next-due is a derived field kept in sync by a trigger on bill_instances
  -- (see migration 11). It is the soonest unpaid instance.
  next_due_on     date,
  is_active       boolean               not null default true,
  auto_pay        boolean               not null default false,
  created_at      timestamptz           not null default now(),
  updated_at      timestamptz           not null default now()
);

create index bills_household_idx on public.bills (household_id) where is_active;
create index bills_next_due_idx   on public.bills (next_due_on) where is_active;

create table public.bill_instances (
  id                  uuid        primary key default gen_random_uuid(),
  bill_id             uuid        not null references public.bills(id) on delete cascade,
  household_id        uuid        not null references public.households(id) on delete cascade,
  due_on              date        not null,
  amount              numeric(20,4) not null check (amount > 0),
  is_paid             boolean     not null default false,
  paid_transaction_id uuid        references public.transactions(id) on delete set null,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (bill_id, due_on)
);

create index bill_instances_bill_idx     on public.bill_instances (bill_id);
create index bill_instances_household_idx on public.bill_instances (household_id, due_on);
create index bill_instances_unpaid_idx   on public.bill_instances (due_on) where not is_paid;

comment on column public.bill_instances.paid_transaction_id is 'When a paid instance links to its ledger transaction, deleting the transaction un-pays the instance (ON DELETE SET NULL).';

-- View the UI uses. Renames due_on → due_date for ergonomics in app code.
create view public.bill_instances_view
with (security_invoker = true) as
select
  bi.id                 as id,
  b.id                  as bill_id,
  b.household_id        as household_id,
  b.name                as bill_name,
  b.account_id          as account_id,
  b.category_id         as category_id,
  bi.due_on             as due_date,
  bi.amount             as amount,
  b.currency            as currency,
  bi.is_paid            as is_paid,
  bi.paid_transaction_id as paid_transaction_id,
  bi.paid_at            as paid_at
from public.bill_instances bi
join public.bills b on b.id = bi.bill_id;

comment on view public.bill_instances_view is 'UI-facing flat join of bills + bill_instances. Updated whenever either table changes.';
