drop view if exists public.bill_instances_view;

alter table public.bills
  rename column amount to default_amount;

alter table public.bills
  alter column default_amount drop not null,
  alter column account_id drop not null,
  add column responsible_member_id uuid references public.household_members(id),
  add column rrule text,
  add column starts_on date,
  add column ends_on date,
  add column reminder_days_before smallint not null default 3
    check (reminder_days_before between 0 and 30);

update public.bills
set
  rrule = case frequency
    when 'weekly' then 'FREQ=WEEKLY'
    when 'biweekly' then 'FREQ=WEEKLY;INTERVAL=2'
    when 'monthly' then 'FREQ=MONTHLY'
    when 'quarterly' then 'FREQ=MONTHLY;INTERVAL=3'
    when 'yearly' then 'FREQ=YEARLY'
  end,
  starts_on = coalesce(next_due_on, current_date);

alter table public.bills
  alter column rrule set not null,
  alter column starts_on set not null,
  add constraint bills_end_after_start check (ends_on is null or ends_on >= starts_on),
  drop column frequency,
  drop column next_due_on,
  drop column auto_pay;

drop type public.bill_frequency;

drop index if exists public.bills_next_due_idx;
drop index if exists public.bills_household_idx;
create index bills_household_active_idx on public.bills (household_id) where is_active;

alter table public.bill_instances
  add column status text,
  add column paid_on date,
  add column paid_by_member_id uuid references public.household_members(id);

update public.bill_instances
set
  status = case when is_paid then 'paid' else 'due' end,
  paid_on = paid_at::date;

alter table public.bill_instances
  alter column status set default 'due',
  alter column status set not null,
  add constraint bill_instances_status_check check (status in ('due', 'paid', 'skipped')),
  add constraint bill_instances_paid_fields_match_status check (
    status = 'paid' or (paid_on is null and paid_by_member_id is null)
  ),
  drop column is_paid,
  drop column paid_at;

drop index if exists public.bill_instances_unpaid_idx;
create index bill_instances_household_status_due_on_idx
  on public.bill_instances (household_id, status, due_on);

create or replace function public.tg_bills_containment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_member_in_household(new.responsible_member_id, new.household_id);

  if new.category_id is not null then
    perform public.assert_same_household(
      (select household_id from public.categories where id = new.category_id),
      new.household_id,
      'bills.category_id must belong to the same household'
    );
  end if;

  if new.account_id is not null then
    perform public.assert_same_household(
      (select household_id from public.accounts where id = new.account_id),
      new.household_id,
      'bills.account_id must belong to the same household'
    );
  end if;

  return new;
end;
$$;

create trigger bills_containment
  before insert or update of household_id, responsible_member_id, category_id, account_id
  on public.bills
  for each row execute function public.tg_bills_containment();

create or replace function public.tg_bill_instances_containment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_member_in_household(new.paid_by_member_id, new.household_id);
  perform public.assert_same_household(
    (select household_id from public.bills where id = new.bill_id),
    new.household_id,
    'bill_instances.bill_id must belong to the same household'
  );

  if new.paid_transaction_id is not null then
    perform public.assert_same_household(
      (select household_id from public.transactions where id = new.paid_transaction_id),
      new.household_id,
      'bill_instances.paid_transaction_id must belong to the same household'
    );
  end if;

  return new;
end;
$$;

create trigger bill_instances_containment
  before insert or update of household_id, bill_id, paid_by_member_id, paid_transaction_id
  on public.bill_instances
  for each row execute function public.tg_bill_instances_containment();

drop policy if exists bills_all on public.bills;
create policy bills_all on public.bills
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

drop policy if exists bill_instances_all on public.bill_instances;
create policy bill_instances_all on public.bill_instances
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

create view public.bill_instances_view
with (security_invoker = on) as
select
  bi.*,
  case
    when bi.status <> 'due' then bi.status
    when bi.due_on < (now() at time zone h.timezone)::date then 'overdue'
    else 'due'
  end as effective_status
from public.bill_instances bi
join public.households h on h.id = bi.household_id;

grant select on public.bill_instances_view to anon, authenticated;
