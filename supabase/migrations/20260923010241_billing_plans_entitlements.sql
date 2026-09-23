-- Billing foundation for epic #255 (Phase A): plans, per-plan features,
-- household subscriptions, provider webhook events, and the three
-- fail-closed entitlement helpers. Seed values come from ADR 0001
-- (docs/adr/0001-plan-catalogue.md, decided in #256).
--
-- Failure semantics (do not "simplify"): no subscription row means no
-- entitlement; a plan_features row with limit_value NULL means explicitly
-- unlimited; a MISSING plan_features row means zero. The partial unique
-- index status list and the household_plan() status list live in this same
-- migration so they cannot drift.

create table plans (
  code        text primary key,
  name        text not null,
  is_public   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table plan_features (
  plan_code   text not null references plans(code) on delete cascade,
  feature_key text not null,
  enabled     boolean not null default false,
  limit_value int,          -- NULL means explicitly unlimited; a MISSING ROW means zero
  primary key (plan_code, feature_key)
);

create table subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references households(id) on delete cascade,
  plan_code            text not null references plans(code),
  provider             text not null default 'stub',
  provider_ref         text,
  status               text not null check (status in
                         ('trialing','active','past_due','grace','cancelled','expired')),
  trial_ends_at        timestamptz,
  current_period_end   timestamptz,
  grace_ends_at        timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint dunning_needs_grace_end check (
    status not in ('past_due','grace') or grace_ends_at is not null
  ),
  unique (provider, provider_ref)
);

-- At most one live subscription per household. The status list here MUST match
-- the entitled-status list in household_plan() or that function becomes
-- non-deterministic.
create unique index subscriptions_one_live
  on subscriptions (household_id)
  where status in ('trialing','active','past_due','grace','cancelled');

create table billing_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  provider_event_id text not null,
  subscription_id   uuid references subscriptions(id) on delete set null,
  type              text not null,
  payload           jsonb not null,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  unique (provider, provider_event_id)   -- webhook dedupe
);

create or replace function household_plan(p_household uuid)
returns text language sql stable security definer set search_path = '' as $$
  select s.plan_code
  from public.subscriptions s
  where s.household_id = p_household
    and s.status in ('trialing','active','past_due','grace','cancelled')
    -- past_due and grace have a current_period_end already in the past, so the
    -- guard must prefer grace_ends_at. A comped plan has neither, hence infinity.
    and coalesce(s.grace_ends_at, s.current_period_end, 'infinity'::timestamptz) > now()
  limit 1
$$;

create or replace function has_feature(p_household uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select pf.enabled
       from public.plan_features pf
      where pf.plan_code = public.household_plan(p_household)
        and pf.feature_key = p_feature),
    false)          -- no plan, or no row: NOT entitled
$$;

create or replace function feature_limit(p_household uuid, p_feature text)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select coalesce(pf.limit_value, 2147483647)   -- NULL limit = explicitly unlimited
       from public.plan_features pf
      where pf.plan_code = public.household_plan(p_household)
        and pf.feature_key = p_feature),
    0)                                             -- missing row = zero, never unlimited
$$;

revoke execute on function household_plan(uuid) from public;
revoke execute on function has_feature(uuid, text) from public;
revoke execute on function feature_limit(uuid, text) from public;
grant  execute on function household_plan(uuid) to authenticated;
grant  execute on function has_feature(uuid, text) to authenticated;
grant  execute on function feature_limit(uuid, text) to authenticated;

-- Seed from ADR 0001. Feature keys are the household-scoped vocabulary the
-- helpers answer. The ADR's household-count cap (free 1 / plus 3) is
-- user-scoped, not household-scoped, so it has no row here by design — a
-- missing row means zero under feature_limit(), and seeding it would poison
-- future checks. Enforce household count at the app layer.
insert into plans (code, name, is_public, sort_order) values
  ('free', 'Duo', true, 0),
  ('plus', 'Plus', true, 1);

insert into plan_features (plan_code, feature_key, enabled, limit_value) values
  -- free: solo member, 4 accounts, 1-year visible history, no export
  ('free', 'partner_sharing',    false, null),
  ('free', 'member_seats',       true,  1),
  ('free', 'accounts',           true,  4),
  ('free', 'history_days',       true,  365),
  ('free', 'budgets',            true,  null),
  ('free', 'bill_reminders',     true,  null),
  ('free', 'export',             false, null),
  ('free', 'long_range_reports', false, null),
  -- plus: partner sharing + extra seat, unlimited accounts/history, export
  ('plus', 'partner_sharing',    true,  null),
  ('plus', 'member_seats',       true,  3),
  ('plus', 'accounts',           true,  null),
  ('plus', 'history_days',       true,  null),
  ('plus', 'budgets',            true,  null),
  ('plus', 'bill_reminders',     true,  null),
  ('plus', 'export',             true,  null),
  ('plus', 'long_range_reports', true,  null);

alter table public.plans enable row level security;
alter table public.plan_features enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;

-- The catalogue is public to signed-in users (paywall UI needs it).
-- No writes via RLS; seeds change by migration only.
create policy plans_select_authenticated
  on public.plans for select to authenticated
  using (true);

create policy plan_features_select_authenticated
  on public.plan_features for select to authenticated
  using (true);

-- A household reads only its own subscription. Writes are service-role only
-- (provider webhooks, dunning) — no insert/update/delete policies here.
create policy subscriptions_select_own_household
  on public.subscriptions for select to authenticated
  using (public.is_member(household_id));

-- Webhook ingest data is service-role only. No authenticated policies at all:
-- fail closed, even for reads.
-- Intentionally no policies for authenticated on billing_events.

comment on table public.subscriptions is
  'One live subscription per household (partial unique index). Writes are service-role only; households read their own row via RLS.';
comment on table public.billing_events is
  'Raw provider webhook events with (provider, provider_event_id) dedupe. Service-role only; no authenticated access by design.';

grant select on public.plans, public.plan_features to authenticated;
grant select on public.subscriptions to authenticated;
-- billing_events: no grants to anon/authenticated; service_role bypasses RLS.
-- anon gets nothing on any of the four tables (anon cannot execute the
-- helpers either — revoked from public above).
