alter table public.transactions
  add column account_amount numeric(38,4);

create or replace function public.tg_transactions_set_account_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_currency char(3);
  v_base_currency char(3);
begin
  select a.currency, h.base_currency
    into v_account_currency, v_base_currency
  from public.accounts a
  join public.households h on h.id = a.household_id
  where a.id = new.account_id
    and a.household_id = new.household_id;

  if v_account_currency is null then
    raise exception 'transaction account must belong to its household' using errcode = 'check_violation';
  end if;

  new.account_amount := case
    when new.currency = v_account_currency then round(new.amount, 4)
    when v_account_currency = v_base_currency then round(new.amount * new.fx_rate, 4)
    else round(
      new.amount * public.fx_rate_on(
        new.household_id,
        new.occurred_on,
        new.currency,
        v_account_currency
      ),
      4
    )
  end;

  return new;
end;
$$;

create trigger transactions_set_account_amount
before insert or update of account_id, amount, currency, fx_rate, occurred_on, household_id
on public.transactions
for each row execute function public.tg_transactions_set_account_amount();

alter table public.transactions disable trigger transactions_prevent_transfer_update;
alter table public.transactions disable trigger transactions_protect_transfer_group;

update public.transactions t
set account_amount = case
  when t.currency = a.currency then round(t.amount, 4)
  when a.currency = h.base_currency then round(t.amount * t.fx_rate, 4)
  else round(t.amount * public.fx_rate_on(t.household_id, t.occurred_on, t.currency, a.currency), 4)
end
from public.accounts a
join public.households h on h.id = a.household_id
where a.id = t.account_id
  and h.id = t.household_id;

alter table public.transactions enable trigger transactions_prevent_transfer_update;
alter table public.transactions enable trigger transactions_protect_transfer_group;

alter table public.transactions
  alter column account_amount set default 0,
  alter column account_amount set not null;

comment on column public.transactions.account_amount is
  'Signed, in the account currency. Snapshot at transaction creation or monetary edit; account ledger balances aggregate this column.';

create or replace function public.tg_accounts_prevent_currency_change_with_transactions()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.currency is distinct from old.currency
    and exists (select 1 from public.transactions where account_id = old.id) then
    raise exception 'cannot change an account currency after transactions exist'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger accounts_prevent_currency_change_with_transactions
before update of currency on public.accounts
for each row execute function public.tg_accounts_prevent_currency_change_with_transactions();

create or replace view public.account_balances
with (security_invoker = true) as
select
  a.*,
  a.id as account_id,
  case a.balance_mode
    when 'manual' then coalesce(a.manual_balance, 0)
    else a.opening_balance + coalesce(sum(t.account_amount), 0)
  end as balance,
  max(t.created_at) as last_transaction_at
from public.accounts a
left join public.transactions t on t.account_id = a.id
group by a.id;

grant select on public.account_balances to authenticated;
