create or replace function public.pay_bill_instance(
  p_instance_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_paid_by_member_id uuid,
  p_create_transaction boolean default true
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household_id uuid;
  v_bill_id uuid;
  v_bill_name text;
  v_bill_currency char(3);
  v_account_id uuid;
  v_category_id uuid;
  v_status text;
  v_account_currency char(3);
  v_base_currency char(3);
  v_entered_by uuid;
  v_transaction_id uuid;
  v_fx_rate numeric;
begin
  if p_amount <= 0 then
    raise exception 'payment amount must be positive' using errcode = 'check_violation';
  end if;

  select bi.household_id, bi.bill_id, b.name, b.currency, b.account_id, b.category_id, bi.status
    into v_household_id, v_bill_id, v_bill_name, v_bill_currency, v_account_id, v_category_id, v_status
  from public.bill_instances bi
  join public.bills b on b.id = bi.bill_id
  where bi.id = p_instance_id
  for update of bi;

  if v_household_id is null then
    raise exception 'bill instance not found' using errcode = 'no_data_found';
  end if;

  if v_status <> 'due' then
    raise exception 'only due bill instances can be paid' using errcode = 'check_violation';
  end if;

  v_entered_by := public.current_member_id(v_household_id);
  if v_entered_by is null then
    raise exception 'not a member of this household' using errcode = 'insufficient_privilege';
  end if;

  perform public.check_member_in_household(p_paid_by_member_id, v_household_id);

  if p_create_transaction then
    if v_account_id is null then
      raise exception 'bill needs an account to create a transaction' using errcode = 'check_violation';
    end if;

    select a.currency, h.base_currency
      into v_account_currency, v_base_currency
    from public.accounts a
    join public.households h on h.id = a.household_id
    where a.id = v_account_id and a.household_id = v_household_id;

    if v_account_currency is distinct from v_bill_currency then
      raise exception 'bill currency must match its payment account currency' using errcode = 'check_violation';
    end if;

    v_fx_rate := public.fx_rate_on(v_household_id, p_paid_on, v_bill_currency, v_base_currency);

    insert into public.transactions (
      household_id,
      account_id,
      amount,
      category_id,
      currency,
      description,
      entered_by,
      fx_rate,
      occurred_on,
      spent_by
    ) values (
      v_household_id,
      v_account_id,
      -p_amount,
      v_category_id,
      v_bill_currency,
      v_bill_name,
      v_entered_by,
      v_fx_rate,
      p_paid_on,
      p_paid_by_member_id
    ) returning id into v_transaction_id;
  end if;

  update public.bill_instances
  set
    amount = p_amount,
    paid_by_member_id = p_paid_by_member_id,
    paid_on = p_paid_on,
    paid_transaction_id = v_transaction_id,
    skip_reason = null,
    status = 'paid'
  where id = p_instance_id;
end;
$$;

create or replace function public.unmark_bill_instance_paid(p_instance_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household_id uuid;
  v_status text;
  v_transaction_id uuid;
begin
  select household_id, status, paid_transaction_id
    into v_household_id, v_status, v_transaction_id
  from public.bill_instances
  where id = p_instance_id
  for update;

  if v_household_id is null then
    raise exception 'bill instance not found' using errcode = 'no_data_found';
  end if;

  if v_status <> 'paid' then
    raise exception 'only paid bill instances can be unmarked' using errcode = 'check_violation';
  end if;

  if public.current_member_id(v_household_id) is null then
    raise exception 'not a member of this household' using errcode = 'insufficient_privilege';
  end if;

  update public.bill_instances
  set
    paid_by_member_id = null,
    paid_on = null,
    paid_transaction_id = null,
    status = 'due'
  where id = p_instance_id;

  if v_transaction_id is not null then
    delete from public.transactions where id = v_transaction_id;
  end if;
end;
$$;

grant execute on function public.pay_bill_instance(uuid, numeric, date, uuid, boolean) to authenticated;
grant execute on function public.unmark_bill_instance_paid(uuid) to authenticated;
