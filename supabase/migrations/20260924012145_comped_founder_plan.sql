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
-- - A status-only predicate is not enough: household_plan() also requires
--   time-liveness, so a time-ended-but-unflipped row (cancelled past its
--   period end, lapsed trial/grace window) would block the backfill via the
--   one-live index while resolving to NULL — stuck write-blocked after the
--   backfill ran. Step 2a therefore flips time-ended live rows to expired
--   first (mirroring isExpirable / the #260 sweeper: active rows are never
--   touched), so the backfill sees true entitlement state. Narrow in
--   Phase A (billing off, no such rows in prod) but AC1 reads "every
--   existing household", so the migration closes it rather than the sweeper.
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
--
-- Re-running the backfill (service role only — the function below is
-- revoked from anon/authenticated so no member can self-grant comped):
--   select public.backfill_comped_subscriptions();
-- Idempotent: seed inserts carry ON CONFLICT DO NOTHING and the fill
-- insert targets the one-live partial index, so a concurrent live row
-- (signup racing the deploy) wins instead of aborting with 23505.

-- ============================================================================
-- 1. comped catalogue row: full entitlements, hidden from listings.
--    ON CONFLICT keeps re-runs safe (migrations run once; ops re-runs
--    must not duplicate the seed).
-- ============================================================================

insert into public.plans (code, name, is_public, sort_order) values
  ('comped', 'Founder', false, 2)
on conflict (code) do nothing;

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
  ('comped', 'write_access',       true,  null)
on conflict (plan_code, feature_key) do nothing;

-- ============================================================================
-- 2. Repair + backfill as one shared, idempotent operation.
--    2a flips time-ended live rows to expired (mirroring isExpirable():
--    past_due/grace past grace_ends_at, cancelled past or without its
--    period end, trialing past trial_ends_at; active never). Without this
--    a stale row squats the one-live slot while resolving to NULL, and
--    the fill below would skip the household entirely.
--    2b fills one perpetual active/comped row per household without a live
--    subscription. No dates -> resolves through infinity, sweeper-immune.
--    The fill targets the one-live partial index explicitly, so a live row
--    committed by a concurrent signup between the check and the insert is
--    skipped instead of aborting the deploy with 23505.
--    Defined as a function (not inline) so pgTAP invokes the shipped path
--    instead of a copy of its text.
-- ============================================================================

create or replace function public.backfill_comped_subscriptions()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filled int;
begin
  update public.subscriptions
     set status = 'expired'
   where (status in ('past_due', 'grace') and grace_ends_at <= now())
      or (status = 'cancelled'
          and (current_period_end is null or current_period_end <= now()))
      or (status = 'trialing'
          and trial_ends_at is not null and trial_ends_at <= now());

  insert into public.subscriptions (household_id, plan_code, provider, status)
  select h.id, 'comped', 'stub', 'active'
    from public.households h
   where not exists (
     select 1
       from public.subscriptions s
      where s.household_id = h.id
        and s.status in ('trialing', 'active', 'past_due', 'grace', 'cancelled')
   )
  on conflict (household_id)
    where status in ('trialing', 'active', 'past_due', 'grace', 'cancelled')
    do nothing;

  get diagnostics v_filled = row_count;
  return v_filled;
end;
$$;

-- Service-role / ops only: subscriptions have no authenticated write
-- policies, and this stays that way — no member may self-grant comped.
-- (Service role and superuser bypass grants; pgTAP calls it as superuser.)
revoke all on function public.backfill_comped_subscriptions() from public;

comment on function public.backfill_comped_subscriptions() is
  'Issue #263: idempotent comped repair + backfill. Returns households filled. Safe to re-run; concurrent live rows win via the one-live index.';

select public.backfill_comped_subscriptions();

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
set search_path = ''
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
