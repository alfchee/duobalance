-- Issue #264 (review follow-up): the plan-limit warning in the UI needs the
-- same household-wide count tg_enforce_account_limit() uses. RLS only shows
-- a member shared accounts plus their own private ones
-- (accounts_select, 20260807000001), and account_balances is
-- security_invoker, so a client-side count of visible rows undercounts when
-- private accounts exist on both sides — the 75% warning would never fire
-- even though the next insert is about to be rejected.
--
-- SECURITY DEFINER so the count is exact, mirroring the trigger; the
-- is_member guard closes the cross-household probe a definer helper would
-- otherwise open (is_member answers from auth.uid(), so the guard still
-- reflects the real caller — same pattern as the trigger's early return
-- in 20260923063231). Non-members get 0: fail-closed and leak-free.

create or replace function public.household_account_usage(p_household uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case when public.is_member(p_household) then (
      select count(*)::int
        from public.accounts
       where household_id = p_household
         and not is_archived
    ) end,
    0
  )
$$;

comment on function public.household_account_usage(uuid) is
  'Issue #264: household-wide non-archived account count, the same number tg_enforce_account_limit enforces. SECURITY DEFINER with an is_member guard: members get their household count, everyone else gets 0.';

revoke execute on function public.household_account_usage(uuid) from public;
grant  execute on function public.household_account_usage(uuid) to authenticated;
