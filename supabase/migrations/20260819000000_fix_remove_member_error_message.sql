-- #120: update remove_member exception string for target member lookup to avoid ambiguity with caller membership error.

create or replace function public.remove_member(
  p_household uuid,
  p_member uuid,
  p_account_disposition jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_member_id uuid;
  v_target public.household_members;
  v_acc record;
  v_disp text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.is_owner(p_household) then
    raise exception 'only active owners can remove members';
  end if;

  v_caller_member_id := public.current_member_id(p_household);

  if p_member = v_caller_member_id then
    raise exception 'owners cannot remove themselves; use transfer_ownership or leave_household';
  end if;

  select * into v_target
  from public.household_members
  where id = p_member and household_id = p_household;

  if not found then
    raise exception 'target member not found or not active in this household';
  end if;

  if v_target.removed_at is not null then
    return; -- Idempotent no-op
  end if;

  -- Resolve owned shared accounts.
  -- Scope discipline: only touch shared accounts (is_shared = true). Never touch private accounts (is_shared = false).
  for v_acc in
    select id
    from public.accounts
    where household_id = p_household
      and owner_member_id = p_member
      and is_shared = true
  loop
    v_disp := p_account_disposition->>v_acc.id::text;
    if v_disp = 'transfer' then
      update public.accounts
        set owner_member_id = v_caller_member_id
        where id = v_acc.id;
    elsif v_disp = 'joint' then
      update public.accounts
        set owner_member_id = null
        where id = v_acc.id;
    else
      raise exception 'unresolved owned accounts';
    end if;
  end loop;

  -- Reassign bills assigned to the removed member to caller
  update public.bills
    set responsible_member_id = v_caller_member_id
    where household_id = p_household
      and responsible_member_id = p_member;

  -- Mark membership as removed
  update public.household_members
    set removed_at = now(),
        removal_reason = 'removed',
        removed_by = v_caller_member_id
    where id = p_member;
end;
$$;
