-- #119: household deletion (delete_household) and voluntary exit (leave_household) RPCs.

-- ============================================================================
-- 1. delete_household: soft-delete a household by setting deleted_at = now().
-- Caller must be an active owner of the household. Setting deleted_at immediately
-- revokes access for all members via active_membership.
-- ============================================================================

create or replace function public.delete_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.is_owner(p_household) then
    raise exception 'only active owners can delete a household';
  end if;

  update public.households
    set deleted_at = now()
    where id = p_household
      and deleted_at is null;
end;
$$;

revoke all on function public.delete_household(uuid) from public;
grant execute on function public.delete_household(uuid) to authenticated;

comment on function public.delete_household(uuid) is
  'Soft-deletes a household. Only active owners can call this. Setting deleted_at revokes access for all members via active_membership.';

-- ============================================================================
-- 2. leave_household: voluntary membership removal.
-- - Caller must be an active member.
-- - If caller is the last active member -> delegates to delete_household.
-- - If caller is an owner and other active members remain -> rejects (must transfer ownership first).
-- - Otherwise -> marks membership as left (removed_at = now(), removal_reason = ''left'', removed_by = self).
-- ============================================================================

create or replace function public.leave_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_count int;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.is_member(p_household) then
    raise exception 'not an active member of this household';
  end if;

  select count(*)::int into v_active_count
  from public.active_membership
  where household_id = p_household;

  if v_active_count = 1 then
    perform public.delete_household(p_household);
    return;
  end if;

  if public.is_owner(p_household) then
    raise exception 'owners cannot leave a household with remaining members; transfer ownership first';
  end if;

  v_member_id := public.current_member_id(p_household);
  if v_member_id is null then
    raise exception 'not an active member of this household';
  end if;

  update public.household_members
    set removed_at = now(),
        removal_reason = 'left',
        removed_by = v_member_id
    where id = v_member_id;
end;
$$;

revoke all on function public.leave_household(uuid) from public;
grant execute on function public.leave_household(uuid) to authenticated;

comment on function public.leave_household(uuid) is
  'Allows an active member to leave a household. If the caller is the last active member, closes/soft-deletes the household.';
