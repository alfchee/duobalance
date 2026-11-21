-- Issue #272 review follow-up (PR #301): escape LIKE metacharacters in
-- p_search. Forward-only: 20260930000002 applied, not edited.
--
-- `%`, `_` and `\` in the input acted as LIKE metacharacters, so the
-- search over-matched: owner emails routinely contain `_` (e.g.
-- `ana_g@test.local`, where `_` matched any character), and a literal
-- `%` returned the whole table. No privilege issue (the caller is already
-- an admin), but wrong results for support. p_search is now escaped with
-- `ESCAPE '\'` so it always matches literally; the 80-char cap stays at
-- the API. RETURNS TABLE is unchanged, so only the body is redefined —
-- still via drop + recreate to match this file series' convention.
--
-- Pinned by supabase/tests/38_admin_household_views.sql (literal
-- underscore and literal percent match nothing unless present).

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
declare
  -- Backslash first: the later replacements introduce backslashes that
  -- must not be re-escaped.
  v_search text := replace(
    replace(replace(coalesce(p_search, ''), '\', '\\'),
      '%', '\%'),
    '_', '\_');
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
      or h.name ilike '%' || v_search || '%' escape '\'
      or h.id::text ilike '%' || v_search || '%' escape '\'
      -- Member email match without returning the address: the response
      -- shape has no email column (see scope.ts ADMIN_FORBIDDEN_KEYS).
      or exists (
        select 1
        from public.household_members m
        join auth.users u on u.id = m.user_id
        where m.household_id = h.id
          and u.email ilike '%' || v_search || '%' escape '\'
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

comment on function public.admin_list_households(text, text, int, int) is
  'Issue #272 (+ review): admin household list with last_activity, literal member-email search (filter only, never returned), and comped/none/expired status filters. LIKE metacharacters in p_search are escaped. Counts + billing state only; is_admin() first, 42501 otherwise.';
