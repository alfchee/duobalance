-- Issue #275: admin metrics dashboard — aggregate-only readers sharing the
-- report's SQL definitions (predicates identical to
-- scripts/generate-metrics-report.mjs; fragment agreement pinned by
-- src/lib/metrics-admin-agreement.test.ts).
--
-- Fixtures are three households with known shapes: hh1 is old (retention-
-- eligible on every window, funnel step 8), hh2 is fresh and setup-
-- complete (funnel 5), hh3 is fresh with an owner but nothing else
-- (funnel 3). Expected values below are hand-computed from the report
-- predicates — they prove the functions compute the report's numbers,
-- which is what makes dashboard and report agree for the same date.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

do $$
declare
  hh1    uuid := 'd5000000-0000-0000-0000-000000000001';
  hh2    uuid := 'd5000000-0000-0000-0000-000000000002';
  hh3    uuid := 'd5000000-0000-0000-0000-000000000003';
  o1     uuid := 'd5000000-0000-0000-0000-000000000011';
  p1     uuid := 'd5000000-0000-0000-0000-000000000012';
  o2     uuid := 'd5000000-0000-0000-0000-000000000013';
  o3     uuid := 'd5000000-0000-0000-0000-000000000014';
  m1o    uuid := 'd5000000-0000-0000-0000-000000000021';
  m1p    uuid := 'd5000000-0000-0000-0000-000000000022';
  m2     uuid := 'd5000000-0000-0000-0000-000000000023';
  m3     uuid := 'd5000000-0000-0000-0000-000000000024';
  a1     uuid := 'd5000000-0000-0000-0000-000000000031';
  a2     uuid := 'd5000000-0000-0000-0000-000000000032';
  c1     uuid := 'd5000000-0000-0000-0000-000000000041';
  admin_user uuid := 'd5000000-0000-0000-0000-000000000020';
  outsider uuid := 'd5000000-0000-0000-0000-000000000029';
  v_hh1_created timestamptz := date_trunc('week', now()) - interval '4 weeks';
begin
  insert into auth.users (id, email) values
    (o1, 'm1o44@test.local'),
    (p1, 'm1p44@test.local'),
    (o2, 'm2o44@test.local'),
    (o3, 'm3o44@test.local'),
    (admin_user, 'admin44@test.local'),
    (outsider, 'outsider44@test.local');

  insert into public.households (id, name, country, base_currency, timezone, created_at) values
    (hh1, 'Metrics Old 44', 'CL', 'CLP', 'America/Santiago', v_hh1_created),
    (hh2, 'Metrics New A 44', 'CL', 'CLP', 'America/Santiago', now()),
    (hh3, 'Metrics New B 44', 'NI', 'NIO', 'America/Managua', now());

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (m1o, hh1, o1, 'owner', 'Owner 44'),
    (m1p, hh1, p1, 'partner', 'Partner 44'),
    (m2, hh2, o2, 'owner', 'Owner2 44'),
    (m3, hh3, o3, 'owner', 'Owner3 44');

  insert into public.accounts (id, household_id, name, kind, currency) values
    (a1, hh1, 'Checking 44', 'checking', 'CLP'),
    (a2, hh2, 'Checking2 44', 'checking', 'CLP');

  insert into public.categories (id, household_id, name) values
    (c1, hh1, 'Food 44');

  -- hh1 transaction lands in the week-3 window ([created+14d, created+21d])
  -- and nowhere else: w2 inactive, w3 active, w4 inactive.
  insert into public.transactions
    (household_id, account_id, amount, currency, occurred_on, created_at, description, entered_by, spent_by)
  values
    (hh1, a1, 1000, 'CLP', current_date, v_hh1_created + interval '16 days', 'Old tx 44', m1o, m1o),
    (hh2, a2, 2000, 'CLP', current_date, now(), 'New tx 44', m2, m2);

  insert into public.budgets (household_id, category_id, period_month, amount) values
    (hh1, c1, date_trunc('month', current_date)::date, 50000);

  insert into public.household_invites (household_id, email, role, invited_by) values
    (hh1, 'partner44@test.local', 'partner', m1o);

  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end) values
    (hh1, 'plus', 'stub', 'active', now() + interval '30 days');
  insert into public.subscriptions (household_id, plan_code, provider, status, trial_ends_at, current_period_end) values
    (hh2, 'free', 'stub', 'trialing', now() + interval '7 days', now() + interval '7 days');
  insert into public.subscriptions (household_id, plan_code, provider, status) values
    (hh3, 'comped', 'stub', 'active');

  insert into public.guide_opens (user_id, slug, source, anchor) values
    (o1, 'art-1', 'guide-view', null),
    (o2, 'art-1', 'guide-view', null),
    (o1, 'art-1', 'guide-scroll', 'depth-25'),
    (o1, 'art-1', 'guide-scroll', 'depth-100'),
    (o3, 'art-2', 'help-center', null);

  insert into public.admin_users (user_id, role, note) values
    (admin_user, 'support', 'test admin 44');
end
$$;

select plan(16);

select tests.authenticate_as('d5000000-0000-0000-0000-000000000020');

-- 1. Activation summary: 6 signed-up users, 3 active households, hh1+hh2
-- setup-complete, hh1 budgeted and partner-joined.
select results_eq(
  $$ select * from public.admin_metrics_activation() $$,
  $$ values (6::bigint, 3::bigint, 2::bigint, 1::bigint, 1::bigint, 1::bigint) $$,
  'activation counts match the hand-computed report predicates'
);

-- 2. Funnel drop-off: 3 owners, 0 confirmed, 3 created, 2 accounts, 2
-- transactions, 1 budget, 1 invite, 1 acceptance — with report-clamped loss.
select results_eq(
  $$ select step, reached, lost_at_step from public.admin_metrics_funnel() $$,
  $$ values (1::int, 3::bigint, 0::bigint),
         (2::int, 0::bigint, 3::bigint),
         (3::int, 3::bigint, 0::bigint),
         (4::int, 2::bigint, 1::bigint),
         (5::int, 2::bigint, 0::bigint),
         (6::int, 1::bigint, 1::bigint),
         (7::int, 1::bigint, 0::bigint),
         (8::int, 1::bigint, 0::bigint) $$,
  'funnel steps match the report drop-off CTEs'
);

-- 3. Retention: the 4-week-old cohort is eligible everywhere, active in
-- week 3 only; the current-week cohort (hh2+hh3) is eligible nowhere.
select results_eq(
  $$ select households, week_2_active, week_2_eligible,
            week_3_active, week_3_eligible, week_4_active, week_4_eligible
      from public.admin_metrics_retention()
     where cohort_week = date_trunc('week', now()) - interval '4 weeks' $$,
  $$ values (1::bigint, 0::bigint, 1::bigint, 1::bigint, 1::bigint, 0::bigint, 1::bigint) $$,
  'old cohort retention cells match the report predicates'
);
select results_eq(
  $$ select households, week_2_eligible, week_3_eligible, week_4_eligible
      from public.admin_metrics_retention()
     where cohort_week = date_trunc('week', now()) $$,
  $$ values (2::bigint, 0::bigint, 0::bigint, 0::bigint) $$,
  'fresh cohort is eligible nowhere (not mature)'
);

-- 4. Content articles: art-1 has 2 views / 2 readers / depth-25 + depth-100;
-- art-2 is a help-center mount with no depths.
select results_eq(
  $$ select slug, views, readers, d25, d50, d75, d100
      from public.admin_metrics_content_articles() $$,
  $$ values ('art-1'::text, 2::bigint, 2::bigint, 1::bigint, 0::bigint, 0::bigint, 1::bigint),
         ('art-2'::text, 1::bigint, 1::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint) $$,
  'article engagement matches the report CTEs'
);

-- 5. Sources: scroll pings excluded, guide-view before help-center.
select results_eq(
  $$ select src, cnt from public.admin_metrics_content_sources() $$,
  $$ values ('guide-view'::text, 2::bigint),
         ('help-center'::text, 1::bigint) $$,
  'opens by source match the report CTEs'
);

-- 6. Subscriptions grouped by plan and status.
select results_eq(
  $$ select plan_code, status, households from public.admin_metrics_subscriptions() $$,
  $$ values ('comped'::text, 'active'::text, 1::bigint),
         ('free'::text, 'trialing'::text, 1::bigint),
         ('plus'::text, 'active'::text, 1::bigint) $$,
  'subscription counts by plan and status'
);

-- 7-12. Every reader fails closed for non-admins.
select tests.authenticate_as('d5000000-0000-0000-0000-000000000029');
select throws_ok($$ select * from public.admin_metrics_activation() $$,
  '42501', 'admin access denied', 'outsider activation: 42501');
select throws_ok($$ select * from public.admin_metrics_funnel() $$,
  '42501', 'admin access denied', 'outsider funnel: 42501');
select throws_ok($$ select * from public.admin_metrics_retention() $$,
  '42501', 'admin access denied', 'outsider retention: 42501');
select throws_ok($$ select * from public.admin_metrics_content_articles() $$,
  '42501', 'admin access denied', 'outsider articles: 42501');
select throws_ok($$ select * from public.admin_metrics_content_sources() $$,
  '42501', 'admin access denied', 'outsider sources: 42501');
select throws_ok($$ select * from public.admin_metrics_subscriptions() $$,
  '42501', 'admin access denied', 'outsider subscriptions: 42501');

-- 13. No reader exposes identifiers or contents in its output shape:
-- no email/user/household/content/money columns on any OUT param.
select is_empty(
  $$ select parameter_name from information_schema.parameters
      where specific_schema = 'public'
        and specific_name ilike '%admin\_metrics\_%'
        and parameter_mode = 'OUT'
        and parameter_name in ('email', 'user_id', 'member_id', 'household_id',
          'description', 'amount', 'merchant', 'notes', 'payload',
          'account_name', 'category', 'display_name') $$,
  'metrics outputs are counts and labels only'
);

-- 14. ...nor do the function bodies read transaction/account content
-- columns (counts and exists-checks only; user_id survives inside bodies
-- solely for the readers-distinct-count the report also computes).
select is_empty(
  $$ select routine_name from information_schema.routines
      where routine_schema = 'public'
        and routine_name like 'admin\_metrics\_%'
        and (routine_definition ilike '%description%'
          or routine_definition ilike '%merchant%'
          or routine_definition ilike '%payload%'
          or routine_definition ilike '%notes%'
          or routine_definition ilike '%account\_name%'
          or routine_definition ilike '%email%') $$,
  'metrics functions never read content or identity columns'
);

-- 15. The coordinator summary row is a single row (route expects one).
select tests.authenticate_as('d5000000-0000-0000-0000-000000000020');
select is(
  (select count(*)::int from public.admin_metrics_activation()),
  1,
  'activation summary returns exactly one row'
);

select tests.clear_auth();
select * from finish();
