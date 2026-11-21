-- Harden the billing entitlement helpers (PR #277 review follow-up).
--
-- 1. SECURITY DEFINER -> SECURITY INVOKER. As DEFINER, any authenticated
--    user could pass another household's UUID and read its plan and
--    entitlements, bypassing the subscriptions RLS policy. As INVOKER the
--    caller's RLS applies inside the helpers too: own household resolves,
--    any other household fail-closes to no-plan (NULL / false / 0). This
--    matches the repo prior art for household-parameterized read helpers
--    (reports aggregate functions are SECURITY INVOKER). Grants are
--    unchanged: revoked from public (anon stays 42501), granted to
--    authenticated.
--
-- 2. Trial expiry ends entitlement (ADR 0001: trials auto-downgrade, no
--    card, no auto-charge). The original predicate never read
--    trial_ends_at, so a trialing row with an expired trial and NULL
--    period/grace ends fell through to 'infinity' and stayed entitled
--    forever. For trialing rows the chain now consults trial_ends_at
--    before infinity. past_due/grace rows still prefer grace_ends_at, so
--    a stale trial_ends_at on those rows is correctly ignored.
--
-- Deliberate non-change: the one-live partial index still keys on status
-- alone (partial-index predicates must be immutable, now() is not), so an
-- expired-but-unflipped row keeps blocking replacement inserts. Flipping
-- status to expired is the future dunning writer's contract.

create or replace function household_plan(p_household uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select s.plan_code
  from public.subscriptions s
  where s.household_id = p_household
    and s.status in ('trialing','active','past_due','grace','cancelled')
    -- past_due and grace have a current_period_end already in the past, so the
    -- guard must prefer grace_ends_at. A comped plan has neither, hence infinity.
    -- trialing rows consult trial_ends_at so an expired trial stops resolving.
    and coalesce(s.grace_ends_at, s.current_period_end,
                 case when s.status = 'trialing' then s.trial_ends_at end,
                 'infinity'::timestamptz) > now()
  limit 1
$$;

create or replace function has_feature(p_household uuid, p_feature text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(
    (select pf.enabled
       from public.plan_features pf
      where pf.plan_code = public.household_plan(p_household)
        and pf.feature_key = p_feature),
    false)          -- no plan, or no row: NOT entitled
$$;

create or replace function feature_limit(p_household uuid, p_feature text)
returns int language sql stable security invoker set search_path = '' as $$
  select coalesce(
    (select coalesce(pf.limit_value, 2147483647)   -- NULL limit = explicitly unlimited
       from public.plan_features pf
      where pf.plan_code = public.household_plan(p_household)
        and pf.feature_key = p_feature),
    0)                                             -- missing row = zero, never unlimited
$$;
