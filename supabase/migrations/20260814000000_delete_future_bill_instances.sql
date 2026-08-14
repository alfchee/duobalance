create table public.bill_instance_deletions (
  bill_id uuid not null references public.bills(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  due_on date not null,
  deleted_at timestamptz not null default now(),
  primary key (bill_id, due_on)
);

create index bill_instance_deletions_household_id_idx
  on public.bill_instance_deletions (household_id);

alter table public.bill_instance_deletions enable row level security;

revoke all on table public.bill_instance_deletions from anon, authenticated;
grant select on table public.bill_instance_deletions to service_role;

create function public.delete_future_bill_instance(p_instance_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill_id uuid;
  v_household_id uuid;
  v_due_on date;
  v_status text;
  v_timezone text;
begin
  select bi.bill_id, bi.household_id, bi.due_on, bi.status, h.timezone
    into v_bill_id, v_household_id, v_due_on, v_status, v_timezone
  from public.bill_instances bi
  join public.households h on h.id = bi.household_id
  where bi.id = p_instance_id
  for update of bi;

  if v_bill_id is null or public.current_member_id(v_household_id) is null then
    raise exception 'bill instance not found' using errcode = 'no_data_found';
  end if;

  if v_status <> 'due' then
    raise exception 'only due bill instances can be deleted' using errcode = 'check_violation';
  end if;

  if v_due_on <= (now() at time zone v_timezone)::date then
    raise exception 'only future bill instances can be deleted' using errcode = 'check_violation';
  end if;

  insert into public.bill_instance_deletions (bill_id, household_id, due_on)
  values (v_bill_id, v_household_id, v_due_on)
  on conflict (bill_id, due_on) do nothing;

  delete from public.bill_instances where id = p_instance_id;
end;
$$;

revoke all on function public.delete_future_bill_instance(uuid) from public;
grant execute on function public.delete_future_bill_instance(uuid) to authenticated;
