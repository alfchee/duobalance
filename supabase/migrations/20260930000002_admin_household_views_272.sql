-- Issue #272: admin household and subscription views (epic #255 Phase A).
-- Forward-only: 20260929 + 20260930000001 applied, not edited.
--
-- What changes and why (support needs one screen to answer what plan,
-- why access changed, when it renews — without ever seeing what the
-- household spent):
--
-- 1. last_activity on both readers. Defined as the latest user-driven
--    timestamp for the household: GREATEST of household creation, newest
--    transaction row, newest account row, newest membership row. Billing
--    timestamps (subscription updated_at, billing event received_at) are
--    deliberately NOT included: last_activity answers "when did the
--    household last do something", and the detail timeline answers the
--    billing half. Falls back to h.created_at so it is never null.
-- 2. Owner/member email search. p_search now also matches a member's
--    auth.users email (ILIKE, same 80-char cap enforced at the API). The
--    email address itself is NEVER returned — ADMIN_FORBIDDEN_KEYS still
--    lists "email" and the RETURNS TABLE has no email column — the match
--    only filters. Support can paste the address from a ticket without
--    the response leaking a roster.
-- 3. Status filters for the one-screen answers: 'comped' (live comped
--    row), 'none' (no live subscription — covers expired + never), and
--    'expired' (no live row but an expired subscription exists). Plain
--    lifecycle statuses match the live row as before. Unknown values match
--    nothing rather than everything (fail closed).
-- 4. Responsiveness at a few thousand households: the list stays
--    keyset-pageable via LIMIT/OFFSET (API caps 200, default 50) ordered
--    by h.created_at desc (households_created_at_idx), and per-row work
--    stays at three indexed counts + three indexed max() lookups. New
--    index on transactions(household_id, created_at desc) so the
--    last_activity probe does not seq-scan per row.
--
-- No transaction contents: the only contact with public.transactions is
-- still count(*) + max(created_at). No description/amount/merchant/notes/
-- category/account-name column is selected; the pgTAP suite
-- (supabase/tests/38_admin_household_views.sql) pins that.

-- Index for the last_activity probe (per-row max, limit-50 page stays cheap).
create index if not exists transactions_household_created_idx
  on public.transactions (household_id, created_at desc);

-- RETURNS TABLE gains last_activity, so drop + recreate (42P13 otherwise).
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
  last_activity     timestamptz,
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
    greatest(
      h.created_at,
      coalesce((select max(t.created_at) from public.transactions t where t.household_id = h.id), h.created_at),
      coalesce((select max(a.created_at) from public.accounts a where a.household_id = h.id), h.created_at),
      coalesce((select max(m.joined_at) from public.household_members m where m.household_id = h.id), h.created_at)
    ) as last_activity,
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
  where (
      p_search is null
      or h.name ilike '%' || p_search || '%'
      or h.id::text ilike '%' || p_search || '%'
      -- Member email match without returning the address: the response
      -- shape has no email column (see scope.ts ADMIN_FORBIDDEN_KEYS).
      or exists (
        select 1
        from public.household_members m
        join auth.users u on u.id = m.user_id
        where m.household_id = h.id
          and u.email ilike '%' || p_search || '%'
      )
    )
    and (
      p_status is null
      or (p_status = 'comped' and s.plan_code = 'comped')
      or (p_status = 'none' and s.status is null)
      or (p_status = 'expired' and s.status is null
          and exists (
            select 1 from public.subscriptions e
            where e.household_id = h.id and e.status = 'expired'
          ))
      or (s.status = p_status)
    )
  order by h.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke execute on function public.admin_list_households(text, text, int, int) from public;
grant execute on function public.admin_list_households(text, text, int, int) to authenticated;

-- Detail summary gains the same last_activity so the detail header and the
-- list row agree on "when did they last do something".
drop function if exists public.admin_get_household(uuid);

create function public.admin_get_household(p_household uuid)
returns table (
  household_id      uuid,
  household_name    text,
  country           text,
  created_at        timestamptz,
  last_activity     timestamptz,
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
    greatest(
      h.created_at,
      coalesce((select max(t.created_at) from public.transactions t where t.household_id = h.id), h.created_at),
      coalesce((select max(a.created_at) from public.accounts a where a.household_id = h.id), h.created_at),
      coalesce((select max(m.joined_at) from public.household_members m where m.household_id = h.id), h.created_at)
    ) as last_activity,
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
  where h.id = p_household;
end;
$$;

revoke execute on function public.admin_get_household(uuid) from public;
grant execute on function public.admin_get_household(uuid) to authenticated;

comment on function public.admin_list_households(text, text, int, int) is
  'Issue #272: admin household list with last_activity, member-email search (filter only, never returned), and comped/none/expired status filters. Counts + billing state only; is_admin() first, 42501 otherwise.';
comment on function public.admin_get_household(uuid) is
  'Issue #272: admin household summary with last_activity. Counts + billing state only; is_admin() first, 42501 otherwise.';
