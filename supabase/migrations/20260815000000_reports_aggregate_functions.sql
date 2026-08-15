create or replace function public.report_monthly_totals(
  p_household uuid,
  p_from date,
  p_to date,
  p_member uuid default null
)
returns table (
  period_month date,
  income numeric,
  expense numeric,
  net numeric
)
language sql
security invoker
stable
as $$
  select
    date_trunc('month', t.occurred_on)::date,
    coalesce(sum(t.base_amount) filter (where t.base_amount > 0), 0),
    coalesce(-sum(t.base_amount) filter (where t.base_amount < 0), 0),
    coalesce(sum(t.base_amount), 0)
  from public.transactions t
  where t.household_id = p_household
    and t.occurred_on between p_from and p_to
    and t.transfer_group_id is null
    and (p_member is null or t.spent_by = p_member)
  group by 1
  order by 1;
$$;

create or replace function public.report_category_totals(
  p_household uuid,
  p_from date,
  p_to date,
  p_kind text,
  p_member uuid default null
)
returns table (
  category_id uuid,
  category_name text,
  color_hex text,
  total numeric,
  txn_count bigint
)
language plpgsql
security invoker
stable
as $$
begin
  if p_kind not in ('expense', 'income') then
    raise exception 'p_kind must be expense or income, got %', p_kind;
  end if;

  return query
  select
    t.category_id,
    c.name,
    coalesce(c.color_hex, '#9ca3af'),
    sum(abs(t.base_amount)),
    count(*)
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  where t.household_id = p_household
    and t.occurred_on between p_from and p_to
    and t.transfer_group_id is null
    and (p_member is null or t.spent_by = p_member)
    and case p_kind
      when 'expense' then t.base_amount < 0
      when 'income' then t.base_amount > 0
    end
  group by t.category_id, c.name, c.color_hex
  order by 4 desc;
end;
$$;

grant execute on function public.report_monthly_totals(uuid, date, date, uuid) to authenticated;
grant execute on function public.report_category_totals(uuid, date, date, text, uuid) to authenticated;
