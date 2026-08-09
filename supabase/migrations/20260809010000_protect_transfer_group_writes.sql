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

  perform set_config('app.create_transfer', 'true', true);

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

  perform set_config('app.create_transfer', 'false', true);

  return v_group_id;
end;
$$;

create or replace function public.tg_transactions_protect_transfer_group()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.transfer_group_id is not null
    and current_setting('app.create_transfer', true) is distinct from 'true' then
    raise exception 'transfer_group_id is managed by create_transfer' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger transactions_protect_transfer_group
before insert or update on public.transactions
for each row execute function public.tg_transactions_protect_transfer_group();
