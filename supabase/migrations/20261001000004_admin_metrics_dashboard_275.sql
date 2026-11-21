-- Issue #275: admin metrics dashboard (epic #255 Phase A). Forward-only.
--
-- The dashboard surfaces the generated report's numbers without anyone
-- running a script — from the SAME SQL definitions, not rewrites. Each
-- function below carries the report's CTEs verbatim
-- (scripts/generate-metrics-report.mjs); only the final SELECT changes,
-- from markdown string-concat to structured rows the API returns as JSON.
-- A source-scan test (src/lib/metrics-admin-agreement.test.ts) asserts the
-- canonical fragments exist in BOTH files, so either side drifting breaks
-- the build. Same predicates over the same live tables means the dashboard
-- and the report agree for the same date by construction.
--
-- Scope notes (mirroring the issue):
--
-- - Ported: activation summary counts, funnel drop-off, cohort retention,
--   content engagement (per-article + by-source), and subscription counts
--   by plan/status (new — the report has no billing section yet).
-- - Deliberately NOT ported: per-household furthest-step tables (per-row
--   drill into financial behaviour), time-to-first-transaction
--   distributions, weekly per-household activity, historical snapshots,
--   and qualitative feedback (message previews are PII). The dashboard is
--   aggregates only: counts, never identifiers, contents, or amounts.
-- - Revenue has no data source yet (no prices, no provider), so there is
--   no revenue function here at all. The ROUTE omits the revenue section
--   while BILLING_ENABLED is off and returns an explicit empty placeholder
--   once on — the flag gate lives at the route layer with every other
--   billing surface (#262), not in SQL.
-- - Markdown escaping from the report (pipe/newline replacement in slugs)
--   is presentation of that artifact and is not carried over; JSON needs
--   none. Rate/percentage arithmetic that the report formats as strings
--   (lost %, cumulative %, completion %) stays in the UI from the same
--   formula — the counts they divide are the SQL-defined values.
--
-- All functions are STABLE DEFINER readers: is_admin() first (42501
-- otherwise), revoked from public, granted to authenticated. The only
-- contact with user-data tables is count(*)/exists/distinct-counts —
-- pinned by the pgTAP suite over OUT params and function bodies.

-- Activation summary (report "Activation" CTEs, structured).
create or replace function public.admin_metrics_activation()
returns table (
  signed_up_users          bigint,
  active_households        bigint,
  setup_complete           bigint,
  budget_created           bigint,
  partner_joined           bigint,
  setup_and_partner_joined bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  return query
  with active_households as (
    select h.id
    from public.households h
    where h.deleted_at is null
  ), setup_complete as (
    select h.id
    from active_households h
    where exists (select 1 from public.accounts a where a.household_id = h.id and not a.is_archived)
      and exists (select 1 from public.transactions t where t.household_id = h.id)
  ), budget_created as (
    select h.id
    from active_households h
    where exists (select 1 from public.budgets b where b.household_id = h.id)
  ), partner_joined as (
    select h.id
    from active_households h
    where (select count(*) from public.household_members m where m.household_id = h.id and m.removed_at is null) >= 2
  ), setup_and_partner_joined as (
    select h.id
    from active_households h
    where exists (select 1 from public.accounts a where a.household_id = h.id and not a.is_archived)
      and exists (select 1 from public.transactions t where t.household_id = h.id)
      and (select count(*) from public.household_members m where m.household_id = h.id and m.removed_at is null) >= 2
  )
  select (select count(*) from auth.users),
         (select count(*) from active_households),
         (select count(*) from setup_complete),
         (select count(*) from budget_created),
         (select count(*) from partner_joined),
         (select count(*) from setup_and_partner_joined);
end;
$$;

revoke execute on function public.admin_metrics_activation() from public;
grant execute on function public.admin_metrics_activation() to authenticated;

comment on function public.admin_metrics_activation() is
  'Issue #275: activation summary counts from the report Activation CTEs (structured). Aggregates only; is_admin() first, 42501 otherwise.';

-- Funnel drop-off (report "Activation Funnel — Drop-off" CTEs, structured).
create or replace function public.admin_metrics_funnel()
returns table (
  step         int,
  name         text,
  reached      bigint,
  lost_at_step bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  return query
  with active_households as (
    select h.id from public.households h where h.deleted_at is null
  ), owner as (
    select m.household_id, min(u.created_at) as signed_up_at, min(u.email_confirmed_at) as email_confirmed_at
    from public.household_members m
    join auth.users u on u.id = m.user_id
    where m.removed_at is null and m.role = 'owner'
    group by m.household_id
  ), account_first as (
    select h.id as household_id, min(a.created_at) as first_account_at
    from active_households h
    join public.accounts a on a.household_id = h.id and not a.is_archived
    group by h.id
  ), transaction_first as (
    select h.id as household_id, min(t.created_at) as first_transaction_at
    from active_households h
    join public.transactions t on t.household_id = h.id
    group by h.id
  ), budget_first as (
    select h.id as household_id, min(b.period_month)::timestamptz as first_budget_at
    from active_households h
    join public.budgets b on b.household_id = h.id
    group by h.id
  ), invite_first as (
    select h.id as household_id, min(i.created_at) as first_invite_at
    from active_households h
    join public.household_invites i on i.household_id = h.id and i.role = 'partner'
    group by h.id
  ), partner_joined as (
    select h.id as household_id, min(m.joined_at) as partner_joined_at
    from active_households h
    join public.household_members m on m.household_id = h.id and m.role = 'partner' and m.removed_at is null
    group by h.id
  ), funnel_counts as (
    select
      (select count(*) from owner) as signed_up,
      (select count(*) from owner where email_confirmed_at is not null) as email_confirmed,
      (select count(*) from active_households) as household_created,
      (select count(*) from account_first) as first_account,
      (select count(*) from transaction_first) as first_transaction,
      (select count(*) from budget_first) as first_budget,
      (select count(*) from invite_first) as partner_invited,
      (select count(*) from partner_joined) as partner_accepted
  ), steps(step, name, reached) as (
    values
      (1, '1 — Signed up', (select signed_up from funnel_counts)),
      (2, '2 — Email confirmed', (select email_confirmed from funnel_counts)),
      (3, '3 — Household created', (select household_created from funnel_counts)),
      (4, '4 — First account created', (select first_account from funnel_counts)),
      (5, '5 — First transaction entered', (select first_transaction from funnel_counts)),
      (6, '6 — First budget created', (select first_budget from funnel_counts)),
      (7, '7 — Partner invited', (select partner_invited from funnel_counts)),
      (8, '8 — Partner accepted', (select partner_accepted from funnel_counts))
  ), drop_off as (
    select
      s.step,
      s.name,
      s.reached,
      lag(s.reached) over (order by s.step) as prev_reached,
      case when lag(s.reached) over (order by s.step) is null then 0 else greatest(lag(s.reached) over (order by s.step) - s.reached, 0) end as lost_at_step
    from steps s
  )
  select d.step, d.name, d.reached, d.lost_at_step from drop_off d order by d.step;
end;
$$;

revoke execute on function public.admin_metrics_funnel() from public;
grant execute on function public.admin_metrics_funnel() to authenticated;

comment on function public.admin_metrics_funnel() is
  'Issue #275: funnel drop-off from the report Drop-off CTEs (structured). Aggregates only; is_admin() first, 42501 otherwise.';

-- Cohort retention (report "Retention By Household Cohort" CTEs, structured).
create or replace function public.admin_metrics_retention()
returns table (
  cohort_week   timestamptz,
  households    bigint,
  week_2_active bigint,
  week_2_eligible bigint,
  week_3_active bigint,
  week_3_eligible bigint,
  week_4_active bigint,
  week_4_eligible bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  return query
  with cohorts as (
    select id, created_at, date_trunc('week', created_at) as cohort_week
    from public.households
    where deleted_at is null
  ), retention as (
    select cohort_week,
           count(*) as households,
           count(*) filter (where now() >= c.created_at + interval '2 weeks') as week_2_eligible,
           count(*) filter (where now() >= c.created_at + interval '2 weeks' and exists (select 1 from public.transactions t where t.household_id = c.id and t.created_at >= c.created_at + interval '1 week' and t.created_at < c.created_at + interval '2 weeks')) as week_2_active,
           count(*) filter (where now() >= c.created_at + interval '3 weeks') as week_3_eligible,
           count(*) filter (where now() >= c.created_at + interval '3 weeks' and exists (select 1 from public.transactions t where t.household_id = c.id and t.created_at >= c.created_at + interval '2 weeks' and t.created_at < c.created_at + interval '3 weeks')) as week_3_active,
           count(*) filter (where now() >= c.created_at + interval '4 weeks') as week_4_eligible,
           count(*) filter (where now() >= c.created_at + interval '4 weeks' and exists (select 1 from public.transactions t where t.household_id = c.id and t.created_at >= c.created_at + interval '3 weeks' and t.created_at < c.created_at + interval '4 weeks')) as week_4_active
    from cohorts c
    group by cohort_week
  )
  select r.cohort_week, r.households,
         r.week_2_active, r.week_2_eligible,
         r.week_3_active, r.week_3_eligible,
         r.week_4_active, r.week_4_eligible
    from retention r
   order by r.cohort_week desc;
end;
$$;

revoke execute on function public.admin_metrics_retention() from public;
grant execute on function public.admin_metrics_retention() to authenticated;

comment on function public.admin_metrics_retention() is
  'Issue #275: cohort retention from the report Retention CTEs (structured). Eligible/active pairs per window; UI renders not-mature at eligible 0. Aggregates only; is_admin() first, 42501 otherwise.';

-- Content engagement per article (report per-article CTEs, structured).
create or replace function public.admin_metrics_content_articles()
returns table (
  slug    text,
  views   bigint,
  readers bigint,
  d25     bigint,
  d50     bigint,
  d75     bigint,
  d100    bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  return query
  with mounts as (
    select slug, count(*) as views, count(distinct user_id) as readers
    from public.guide_opens
    where source in ('guide-view', 'help-center')
    group by slug
  ), depths as (
    select slug,
      count(*) filter (where anchor = 'depth-25') as d25,
      count(*) filter (where anchor = 'depth-50') as d50,
      count(*) filter (where anchor = 'depth-75') as d75,
      count(*) filter (where anchor = 'depth-100') as d100
    from public.guide_opens
    where source = 'guide-scroll'
    group by slug
  ), slugs as (
    select slug from mounts union select slug from depths
  )
  select s.slug, coalesce(m.views, 0), coalesce(m.readers, 0),
         coalesce(d.d25, 0), coalesce(d.d50, 0), coalesce(d.d75, 0), coalesce(d.d100, 0)
    from slugs s
    left join mounts m on m.slug = s.slug
    left join depths d on d.slug = s.slug
   order by coalesce(m.views, 0) desc, s.slug;
end;
$$;

revoke execute on function public.admin_metrics_content_articles() from public;
grant execute on function public.admin_metrics_content_articles() to authenticated;

comment on function public.admin_metrics_content_articles() is
  'Issue #275: per-article engagement from the report CTEs (structured). Slugs are our own article ids; readers is a distinct count, never identities. Aggregates only; is_admin() first, 42501 otherwise.';

-- Content engagement by source (report opens-by-source CTEs, structured).
create or replace function public.admin_metrics_content_sources()
returns table (
  src text,
  cnt bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  return query
  with opens as (
    select coalesce(source, 'unknown') as src, count(*) as cnt
    from public.guide_opens
    where source is distinct from 'guide-scroll'
    group by coalesce(source, 'unknown')
  )
  select o.src, o.cnt from opens o order by o.cnt desc, o.src;
end;
$$;

revoke execute on function public.admin_metrics_content_sources() from public;
grant execute on function public.admin_metrics_content_sources() to authenticated;

comment on function public.admin_metrics_content_sources() is
  'Issue #275: opens by source from the report CTEs (structured). Aggregates only; is_admin() first, 42501 otherwise.';

-- Subscription counts by plan and status (new — the report has no billing
-- section yet, so there is nothing to share; same aggregate discipline).
create or replace function public.admin_metrics_subscriptions()
returns table (
  plan_code  text,
  status     text,
  households bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  return query
  select s.plan_code, s.status, count(*)
    from public.subscriptions s
   group by s.plan_code, s.status
   order by s.plan_code, s.status;
end;
$$;

revoke execute on function public.admin_metrics_subscriptions() from public;
grant execute on function public.admin_metrics_subscriptions() to authenticated;

comment on function public.admin_metrics_subscriptions() is
  'Issue #275: subscription counts by plan and status (new; the report has no billing section). Aggregates only; is_admin() first, 42501 otherwise.';
