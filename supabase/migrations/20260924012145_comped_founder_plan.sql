-- Issue #263: comped founder plan and backfill migration (epic #255 Phase A).
--
-- When BILLING_ENABLED is eventually switched on, every pre-billing
-- household must keep full access: the comped plan carries the whole plus
-- vocabulary (plus write_access), is_public = false so it never appears in
-- plan listings, and its subscriptions carry no dates — household_plan()
-- coalesces nulls to infinity, so the row never time-expires, and the #260
-- sweeper never touches active rows, so no expiry job can flip it.
--
-- Scope:
-- - Backfill covers households with NO live subscription (the pre-#261
--   population plus any household whose row already lapsed to expired).
--   Households already holding a live row (e.g. free/active granted by the
--   #261 create_household window) keep it — they are already entitled, and
--   the one-live partial index forbids a second live row. The predicate
--   below mirrors the entitled-status list in household_plan() and the
--   partial index so the three cannot drift (same discipline as #257).
-- - create_household() now grants comped/active unconditionally. Billing is
--   off in Phase A (no BILLING_ENABLED flag yet; ADR 0001 keeps billing
--   behind the exposure flag), so comped is the correct pre-billing
--   default. When billing turns on, this default changes to free/trial.
--
-- Revoking one (service role only — subscriptions have no authenticated
-- write policies by design):
--   update public.subscriptions set status = 'expired'
--    where household_id = '<uuid>' and status <> 'expired';
-- Expired frees the one-live slot, so the household fail-closes through
-- has_feature()'s missing-plan arm until a real plan is granted.

-- ============================================================================
-- 1. comped catalogue row: full entitlements, hidden from listings.
-- ============================================================================

insert into public.plans (code, name, is_public, sort_order) values
  ('comped', 'Founder', false, 2);

-- Full vocabulary: mirrors plus (all enabled, unlimited where plus is
-- unlimited) plus the #261 write_access gate so #261 policies pass.
insert into public.plan_features (plan_code, feature_key, enabled, limit_value) values
  ('comped', 'partner_sharing',    true,  null),
  ('comped', 'member_seats',       true,  3),
  ('comped', 'accounts',           true,  null),
  ('comped', 'history_days',       true,  null),
  ('comped', 'budgets',            true,  null),
  ('comped', 'bill_reminders',     true,  null),
  ('comped', 'export',             true,  null),
  ('comped', 'long_range_reports', true,  null),
  ('comped', 'write_access',       true,  null);

-- ============================================================================
-- 2. Backfill: one perpetual active/comped row per household without a live
--    subscription. No dates -> resolves through infinity, sweeper-immune.
-- ============================================================================

insert into public.subscriptions (household_id, plan_code, provider, status)
select h.id, 'comped', 'stub', 'active'
  from public.households h
 where not exists (
   select 1
     from public.subscriptions s
    where s.household_id = h.id
      and s.status in ('trialing', 'active', 'past_due', 'grace', 'cancelled')
 );

-- ============================================================================
-- 3. Signup default becomes comped while billing is disabled (#263 replaces
--    the #261 free grant). Granted before the default-account insert so the
--    accounts_enforce_plan_limit trigger (limit 0 with no subscription)
--    never trips.
-- ============================================================================

create or replace function public.create_household(
  p_name text,
  p_country text,
  p_base_currency text,
  p_display_name text,
  p_timezone text default null,
  p_locale text default null,
  p_signup_source text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  h_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform 1
  from auth.users
  where id = auth.uid()
  for update;

  if (
    select count(*)
    from public.active_membership
    where user_id = auth.uid()
  ) >= 5 then
    raise exception 'household limit reached';
  end if;

  insert into public.households (name, country, base_currency, timezone, locale, signup_source)
  values (p_name, p_country, p_base_currency, p_timezone, p_locale, p_signup_source)
  returning id into h_id;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (h_id, auth.uid(), 'owner', p_display_name);

  -- #263: pre-billing default is comped/active (no dates -> infinity,
  -- sweeper-immune). When billing turns on this becomes free/trial.
  insert into public.subscriptions (household_id, plan_code, provider, status)
  values (h_id, 'comped', 'stub', 'active');

  -- Implicit default: a joint cash account in the household base currency.
  -- This removes the "which account?" blocker before the first transaction.
  -- The account is visible and renameable via the normal account edit flow.
  -- Name is localized from p_locale so Spanish/PT households don't get an
  -- English-only "Cash" row that immediately looks untranslated.
  insert into public.accounts (household_id, name, kind, currency, opening_balance, balance_mode, is_shared, owner_member_id, display_order, is_archived)
  values (
    h_id,
    case p_locale when 'es' then 'Efectivo' when 'pt-BR' then 'Dinheiro' else 'Cash' end,
    'cash', p_base_currency, 0, 'ledger', true, null, 0, false
  );

  return h_id;
end;
$$;

revoke all on function public.create_household(text, text, text, text, text, text, text) from public;
grant execute on function public.create_household(text, text, text, text, text, text, text) to authenticated;
