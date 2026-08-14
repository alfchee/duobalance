revoke delete on table public.bill_instances from anon, authenticated;

drop policy if exists bill_instances_all on public.bill_instances;

create policy bill_instances_select on public.bill_instances
  for select to authenticated
  using (public.is_member(household_id));

create policy bill_instances_insert on public.bill_instances
  for insert to authenticated
  with check (public.is_member(household_id));

create policy bill_instances_update on public.bill_instances
  for update to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

create or replace function public.tg_skip_deleted_bill_instance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform 1
  from public.bills
  where id = new.bill_id
  for update;

  if exists (
    select 1
    from public.bill_instance_deletions
    where bill_id = new.bill_id and due_on = new.due_on
  ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists skip_deleted_bill_instance on public.bill_instances;
create trigger skip_deleted_bill_instance
  before insert on public.bill_instances
  for each row execute function public.tg_skip_deleted_bill_instance();

create or replace function public.delete_future_bill_instance(p_instance_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_bill_id uuid;
  v_household_id uuid;
  v_due_on date;
  v_status text;
  v_timezone text;
begin
  select bill_id
    into v_bill_id
  from public.bill_instances
  where id = p_instance_id;

  if v_bill_id is null then
    raise exception 'bill instance not found' using errcode = 'no_data_found';
  end if;

  perform 1
  from public.bills
  where id = v_bill_id
  for update;

  select bi.household_id, bi.due_on, bi.status, h.timezone
    into v_household_id, v_due_on, v_status, v_timezone
  from public.bill_instances bi
  join public.households h on h.id = bi.household_id
  where bi.id = p_instance_id
  for update of bi;

  if v_household_id is null or public.current_member_id(v_household_id) is null then
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
