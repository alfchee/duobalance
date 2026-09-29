-- Admin boundary follow-ups from PR #300 review (issue #271, epic #255).
-- Forward-only: the 20260929 migration below has been applied and is not
-- edited (see also the clarification note at the bottom of this file).
--
-- 1. admin_list_households omitted grace_ends_at while the API allowlist
--    (src/lib/admin/scope.ts ADMIN_HOUSEHOLD_KEYS) and admin_get_household
--    both carry it, so list rows projected grace_ends_at = null even for
--    households in grace. The function is redefined here with the column
--    added to the lateral select and the RETURNS TABLE (same position as
--    admin_get_household: after current_period_end).
--
-- 2. tg_reject_admin_membership_overlap() was left executable by PUBLIC. A
--    bare REVOKE would break trigger firing for ordinary member writes
--    (PostgreSQL checks EXECUTE on the trigger function for the inserting
--    role), so — consistent with every other DEFINER function in this
--    feature — it is revoked from public and granted to authenticated
--    (service_role bypasses RLS and grants by design). Direct invocation
--    remains harmless: outside a trigger context neither branch fires.

-- RETURNS TABLE shape cannot change via CREATE OR REPLACE (42P13), so the
-- function is dropped and recreated here, in this same forward-only
-- migration, with identical grants restored below.
drop function if exists public.admin_list_households(text, text, int, int);

create function public.admin_list_households(
  p_search text default null,
  p_status text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  household_id      uuid,
  household_name    text,
  country           text,
  created_at        timestamptz,
  plan_code         text,
  subscription_status text,
  current_period_end timestamptz,
  grace_ends_at     timestamptz,
  is_comped         boolean,
  member_count      bigint,
  account_count     bigint,
  transaction_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  return query
  select
    h.id,
    h.name,
    h.country,
    h.created_at,
    s.plan_code,
    s.status,
    s.current_period_end,
    s.grace_ends_at,
    (s.plan_code = 'comped') as is_comped,
    (select count(*) from public.household_members m where m.household_id = h.id),
    (select count(*) from public.accounts a where a.household_id = h.id),
    (select count(*) from public.transactions t where t.household_id = h.id)
  from public.households h
  left join lateral (
    select sub.plan_code, sub.status, sub.current_period_end, sub.grace_ends_at
    from public.subscriptions sub
    where sub.household_id = h.id
      and sub.status in ('trialing','active','past_due','grace','cancelled')
      and coalesce(sub.grace_ends_at, sub.current_period_end, 'infinity'::timestamptz) > now()
    limit 1
  ) s on true
  where (p_search is null or h.name ilike '%' || p_search || '%' or h.id::text ilike '%' || p_search || '%')
    and (p_status is null or s.status = p_status)
  order by h.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke execute on function public.admin_list_households(text, text, int, int) from public;
grant execute on function public.admin_list_households(text, text, int, int) to authenticated;

revoke execute on function public.tg_reject_admin_membership_overlap() from public;
grant execute on function public.tg_reject_admin_membership_overlap() to authenticated;

-- Clarification (review nit on the applied 20260929 migration, which cannot
-- be edited forward-only): its header says route handlers call the readers
-- "on the service role scoped to the caller". That was true of the first
-- revision; since PR #300 review the routes call the same DEFINER readers
-- through the caller-scoped client (public key + caller JWT — see
-- createSupabaseUserClient() and docs/admin-boundary.md), so authorization
-- and shape enforce at the database boundary with no service-role use.
-- This comment is the correction on record.
comment on function public.admin_list_households(text, text, int, int) is
  'Issue #271: admin household list (plan/status/period ends incl. grace_ends_at, comped flag, counts only). Called via the caller-scoped client; is_admin() first, 42501 otherwise.';
