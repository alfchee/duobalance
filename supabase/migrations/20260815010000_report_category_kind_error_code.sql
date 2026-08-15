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
    raise exception 'p_kind must be expense or income, got %', p_kind
      using errcode = '22023';
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
