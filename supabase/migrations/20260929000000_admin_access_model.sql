-- Admin access model for issue #271 (epic #255 Phase A).
--
-- The admin app holds billing state across every household, so it is a
-- separate deployment with its own access boundary rather than a route
-- inside the user app. Two rules are absolute and shape this entire file:
--
--   1. No impersonation, ever. There is no function here that returns a
--      household session, no "act as member" helper, and no path from an
--      admin session to a household session. See docs/admin-boundary.md.
--   2. Admin users must never read transaction contents. Admin access goes
--      through the purpose-built functions below, which return billing
--      state, subscription status and aggregate COUNTS only. No function
--      in this migration selects from public.transactions except to COUNT
--      rows; none returns description, amount, merchant, notes, category,
--      or account names. Proved by supabase/tests/36_admin_access_model.sql.
--
-- Role model: public.admin_users lists Supabase auth user ids that hold an
-- admin role. It is deliberately DISTINCT from public.household_members —
-- being an owner of a household never implies is_admin(), and being an
-- admin never implies is_member() of any household. RLS on every
-- household-scoped table keeps enforcing is_member(), so an admin who is
-- not a member reads zero transaction rows through the normal API.
--
-- Access path: the functions below are SECURITY DEFINER with
-- set search_path = '' (epic non-negotiable). Each one checks
-- public.is_admin() FIRST and raises 42501 for non-admins; the API layer
-- maps that to a neutral 404 so a probe learns nothing. Tables have RLS
-- enabled with NO authenticated policies — service-role only — so the
-- functions are the only admin data path.
--
-- Audit: every admin action writes a row to public.admin_audit_log via
-- public.admin_log_action(). Route handlers call it on the service role
-- scoped to the caller; direct client writes are denied by RLS.

-- ============================================================================
-- 1. Tables
-- ============================================================================

create table public.admin_users (
  user_id    uuid not null primary key references auth.users(id) on delete cascade,
  role       text not null default 'support'
             check (role in ('support', 'billing', 'super')),
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.admin_audit_log (
  id               uuid primary key default gen_random_uuid(),
  actor            uuid not null references auth.users(id) on delete restrict,
  action           text not null,
  target_household uuid references public.households(id) on delete set null,
  reason           text,
  before_state     jsonb,
  after_state      jsonb,
  created_at       timestamptz not null default now()
);

create index admin_audit_log_actor_idx on public.admin_audit_log (actor, created_at desc);
create index admin_audit_log_target_idx on public.admin_audit_log (target_household, created_at desc);

alter table public.admin_users enable row level security;
alter table public.admin_audit_log enable row level security;

-- Intentionally NO policies for anon/authenticated on either table:
-- fail closed. Only the service role (bypassing RLS) and the DEFINER
-- functions below touch these tables.
-- Intentionally no grants to anon/authenticated either (service_role
-- bypasses RLS; grants below cover the helper functions, not the tables).

comment on table public.admin_users is
  'Issue #271: admin role roster, distinct from household_members. Membership here never implies household membership and vice versa. No impersonation path exists by design.';
comment on table public.admin_audit_log is
  'Issue #271: append-only audit of every admin action (actor, action, target, reason, before/after, timestamp). Service-role writes only; no client policies by design.';

-- ============================================================================
-- 2. is_admin() — the single admin check
-- ============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

comment on function public.is_admin() is
  'Issue #271: true when the caller holds an admin role. Distinct from is_member(); an admin session never implies a household session.';

-- ============================================================================
-- 3. admin_log_action() — the single audit writer
-- ============================================================================

create or replace function public.admin_log_action(
  p_action text,
  p_target_household uuid default null,
  p_reason text default null,
  p_before jsonb default null,
  p_after jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  if p_action is null or char_length(p_action) = 0 then
    raise exception 'admin action is required' using errcode = '23514';
  end if;
  insert into public.admin_audit_log (actor, action, target_household, reason, before_state, after_state)
  values (auth.uid(), p_action, p_target_household, p_reason, p_before, p_after)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.admin_log_action(text, uuid, text, jsonb, jsonb) from public;
grant execute on function public.admin_log_action(text, uuid, text, jsonb, jsonb) to authenticated;

comment on function public.admin_log_action(text, uuid, text, jsonb, jsonb) is
  'Issue #271: append one audit row per admin action (actor, target, timestamp). Raises 42501 for non-admins so probes fail closed.';

-- ============================================================================
-- 4. Purpose-built admin readers — counts and billing state only.
--
-- None of these functions returns transaction rows. The only contact with
-- public.transactions is count(*) for the household support summary.
-- Column allowlist (enforced by pgTAP over information_schema + function
-- bodies): household id, household name, country, created date, plan code,
-- subscription status, period ends, comped flag, member/account/
-- transaction COUNTS, subscription history, billing-event metadata
-- (provider, event id, type, timestamps — never the payload, never
-- transaction description/amount/merchant/notes/category/account names).
-- ============================================================================

-- Live-subscription helper for the admin readers. Mirrors household_plan()
-- time-liveness (grace_ends_at preferred, comped rows with no dates live
-- forever) without exposing the plan to non-admins; kept private to this
-- migration (no grant beyond the readers that need it internally).
-- Implemented inline in each reader below instead of a shared function so
-- there is exactly one liveness definition per reader to review.

create or replace function public.admin_list_households(
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
    (s.plan_code = 'comped') as is_comped,
    (select count(*) from public.household_members m where m.household_id = h.id),
    (select count(*) from public.accounts a where a.household_id = h.id),
    (select count(*) from public.transactions t where t.household_id = h.id)
  from public.households h
  left join lateral (
    select sub.plan_code, sub.status, sub.current_period_end
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

create or replace function public.admin_get_household(p_household uuid)
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
  where h.id = p_household;
end;
$$;

revoke execute on function public.admin_get_household(uuid) from public;
grant execute on function public.admin_get_household(uuid) to authenticated;

-- Full subscription history for one household: every state transition with
-- its timestamps. Plan/status/period columns only — no financial contents.
create or replace function public.admin_get_subscription_history(p_household uuid)
returns table (
  id               uuid,
  plan_code        text,
  provider         text,
  status           text,
  trial_ends_at    timestamptz,
  current_period_end timestamptz,
  grace_ends_at    timestamptz,
  created_at       timestamptz,
  updated_at       timestamptz
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
    sub.id, sub.plan_code, sub.provider, sub.status,
    sub.trial_ends_at, sub.current_period_end, sub.grace_ends_at,
    sub.created_at, sub.updated_at
  from public.subscriptions sub
  where sub.household_id = p_household
  order by sub.created_at asc;
end;
$$;

revoke execute on function public.admin_get_subscription_history(uuid) from public;
grant execute on function public.admin_get_subscription_history(uuid) to authenticated;

-- Billing-event metadata for one household's subscriptions. Deliberately
-- WITHOUT the payload column: support needs type + timestamps to answer
-- "why did access change", never provider payload contents. Joins through
-- subscriptions so only events for this household's subscriptions appear.
create or replace function public.admin_get_billing_events(p_household uuid)
returns table (
  id                uuid,
  provider          text,
  provider_event_id text,
  subscription_id   uuid,
  type              text,
  received_at       timestamptz,
  processed_at      timestamptz
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
    e.id, e.provider, e.provider_event_id, e.subscription_id,
    e.type, e.received_at, e.processed_at
  from public.billing_events e
  join public.subscriptions sub on sub.id = e.subscription_id
  where sub.household_id = p_household
  order by e.received_at asc;
end;
$$;

revoke execute on function public.admin_get_billing_events(uuid) from public;
grant execute on function public.admin_get_billing_events(uuid) to authenticated;
