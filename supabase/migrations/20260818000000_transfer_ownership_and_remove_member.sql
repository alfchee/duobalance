-- #120: transfer_ownership and remove_member RPCs + owner constraint trigger.

-- ============================================================================
-- 1. Constraint trigger: a household with active members must always retain at
--    least one active owner.
-- ============================================================================

create or replace function public.check_household_has_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select h.id
    from public.households h
    join public.household_members m on m.household_id = h.id
    where h.deleted_at is null
      and m.removed_at is null
    group by h.id
    having count(*) filter (where m.role = 'owner') = 0
  ) then
    raise exception 'household must retain at least one active owner';
  end if;

  return null;
end;
$$;

drop trigger if exists tg_enforce_household_owner on public.household_members;

create trigger tg_enforce_household_owner
  after insert or update or delete on public.household_members
  for each statement execute function public.check_household_has_owner();

comment on function public.check_household_has_owner() is
  'Ensures that any active household with active members always retains at least one active owner.';

-- ============================================================================
-- 2. transfer_ownership: promotes an active partner to owner and optionally demotes caller.
-- ============================================================================

create or replace function public.transfer_ownership(
  p_household uuid,
  p_new_owner uuid,
  p_demote_self boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.is_owner(p_household) then
    raise exception 'only active owners can transfer ownership';
  end if;

  if not exists (
    select 1 from public.active_membership
    where id = p_new_owner and household_id = p_household
  ) then
    raise exception 'target member not found or not active in this household';
  end if;

  update public.household_members
    set role = 'owner'
    where id = p_new_owner and household_id = p_household;

  if p_demote_self then
    v_caller_member_id := public.current_member_id(p_household);
    if v_caller_member_id is not null and v_caller_member_id is distinct from p_new_owner then
      update public.household_members
        set role = 'partner'
        where id = v_caller_member_id;
    end if;
  end if;
end;
$$;

revoke all on function public.transfer_ownership(uuid, uuid, boolean) from public;
grant execute on function public.transfer_ownership(uuid, uuid, boolean) to authenticated;

comment on function public.transfer_ownership(uuid, uuid, boolean) is
  'Promotes an active member to owner, and optionally demotes the caller to partner.';

-- ============================================================================
-- 3. remove_member: removes a partner from a household.
-- ============================================================================

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
    raise exception 'not an active member of this household';
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

revoke all on function public.remove_member(uuid, uuid, jsonb) from public;
grant execute on function public.remove_member(uuid, uuid, jsonb) to authenticated;

comment on function public.remove_member(uuid, uuid, jsonb) is
  'Removes a member from a household, reassigning shared accounts and bills per disposition.';
