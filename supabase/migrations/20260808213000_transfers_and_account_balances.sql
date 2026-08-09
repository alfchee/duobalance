create or replace function public.create_transfer(
  p_household uuid,
  p_from_account uuid,
  p_to_account uuid,
  p_from_amount numeric,
  p_to_amount numeric,
  p_from_fx_rate numeric,
  p_to_fx_rate numeric,
  p_occurred_on date,
  p_description text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group_id uuid := gen_random_uuid();
  v_entered_by uuid := public.current_member_id(p_household);
  v_from_currency text;
  v_to_currency text;
begin
  if v_entered_by is null then
    raise exception 'not a member of this household' using errcode = 'insufficient_privilege';
  end if;

  if p_from_account = p_to_account then
    raise exception 'a transfer requires two different accounts' using errcode = 'check_violation';
  end if;

  if p_from_amount <= 0 or p_to_amount <= 0 then
    raise exception 'transfer amounts must be positive' using errcode = 'check_violation';
  end if;

  if p_from_fx_rate <= 0 or p_to_fx_rate <= 0 then
    raise exception 'transfer exchange rates must be positive' using errcode = 'check_violation';
  end if;

  select currency into v_from_currency
  from public.accounts
  where id = p_from_account and household_id = p_household;

  select currency into v_to_currency
  from public.accounts
  where id = p_to_account and household_id = p_household;

  if v_from_currency is null or v_to_currency is null then
    raise exception 'transfer accounts must belong to the household' using errcode = 'check_violation';
  end if;

  insert into public.transactions (
    household_id,
    account_id,
    amount,
    currency,
    fx_rate,
    occurred_on,
    description,
    entered_by,
    transfer_group_id
  )
  values (
    p_household,
    p_from_account,
    -p_from_amount,
    v_from_currency,
    p_from_fx_rate,
    p_occurred_on,
    p_description,
    v_entered_by,
    v_group_id
  );

  insert into public.transactions (
    household_id,
    account_id,
    amount,
    currency,
    fx_rate,
    occurred_on,
    description,
    entered_by,
    transfer_group_id
  )
  values (
    p_household,
    p_to_account,
    p_to_amount,
    v_to_currency,
    p_to_fx_rate,
    p_occurred_on,
    p_description,
    v_entered_by,
    v_group_id
  );

  return v_group_id;
end;
$$;

create or replace function public.tg_transactions_delete_transfer_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.transfer_group_id is not null and pg_trigger_depth() = 1 then
    delete from public.transactions
    where transfer_group_id = old.transfer_group_id
      and household_id = old.household_id
      and id <> old.id;
  end if;
  return old;
end;
$$;

create trigger transactions_delete_transfer_group
after delete on public.transactions
for each row execute function public.tg_transactions_delete_transfer_group();

create or replace function public.tg_transactions_prevent_transfer_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.transfer_group_id is not null then
    raise exception 'transfers must be deleted and recreated' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger transactions_prevent_transfer_update
before update on public.transactions
for each row execute function public.tg_transactions_prevent_transfer_update();

create or replace function public.delete_transfer(p_transaction_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.transactions where id = p_transaction_id;
  if not found then
    raise exception 'transfer transaction not found' using errcode = 'no_data_found';
  end if;
end;
$$;

create view public.account_balances
with (security_invoker = true) as
select
  a.*,
  a.id as account_id,
  case a.balance_mode
    when 'manual' then coalesce(a.manual_balance, 0)
    else a.opening_balance + coalesce(sum(t.amount), 0)
  end as balance,
  max(t.created_at) as last_transaction_at
from public.accounts a
left join public.transactions t on t.account_id = a.id
group by a.id;

grant select on public.account_balances to authenticated;

drop view public.budget_status;

create view public.budget_status
with (security_invoker = true) as
select
  b.id                                        as budget_id,
  b.household_id,
  b.category_id,
  b.period,
  b.amount                                    as budgeted,
  b.currency,
  coalesce(-sum(t.base_amount), 0)            as spent,
  b.amount - coalesce(-sum(t.base_amount), 0) as remaining,
  case
    when b.amount = 0 then 0
    else round((coalesce(-sum(t.base_amount), 0) / b.amount * 100)::numeric, 2)
  end                                         as pct_used
from public.budgets b
left join public.transactions t
  on t.household_id  = b.household_id
 and (b.category_id is null or t.category_id = b.category_id)
 and t.occurred_on  >= b.starts_on
 and t.amount       <  0
 and t.transfer_group_id is null
 and case b.period
       when 'weekly'  then t.occurred_on <  b.starts_on + interval '7 days'
       when 'monthly' then t.occurred_on <  b.starts_on + interval '1 month'
       when 'yearly'  then t.occurred_on <  b.starts_on + interval '1 year'
     end
where b.is_active
group by b.id, b.household_id, b.category_id, b.period, b.amount, b.currency, b.starts_on;

grant select on public.budget_status to anon, authenticated;
