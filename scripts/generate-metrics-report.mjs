#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.SUPABASE_DB_URL;
const outputDirectory = path.resolve(dirname, "../reports/metrics");
const reportDate = new Date().toISOString().slice(0, 10);
const outputPath = path.join(outputDirectory, `${reportDate}.md`);

function getDatabaseUrl() {
  if (!databaseUrl) {
    throw new Error(
      "SUPABASE_DB_URL must be set in .env.local to generate a metrics report. Use the Supabase Session Pooler connection string for IPv4-only networks.",
    );
  }

  const connection = new URL(databaseUrl);
  if (connection.hostname.startsWith("db.")) {
    throw new Error(
      "SUPABASE_DB_URL uses Supabase's IPv6-only direct database endpoint. Replace it with the Session Pooler URL from Supabase Dashboard > Connect > Session pooler.",
    );
  }

  return databaseUrl;
}

function query(sql) {
  const result = spawnSync(
    "psql",
    [
      "-X",
      "--no-psqlrc",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      getDatabaseUrl(),
      "--command",
      sql,
    ],
    { encoding: "utf8" },
  );

  if (result.error) {
    throw new Error(
      "Unable to run psql. Install PostgreSQL client tools and set SUPABASE_DB_URL for a non-local database.",
    );
  }

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "The metrics query failed.");
  }

  return result.stdout.trim();
}

function section(title, sql, emptyMessage) {
  const result = query(sql);
  return `## ${title}\n\n${result || emptyMessage}`;
}

const report = [
  "# DuoBalance Product Metrics",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "This report uses database timestamps in UTC. A transaction is considered entered when its `created_at` timestamp falls in the measured week; its financial date is not used.",
  "",
  section(
    "Transactions Entered Per Household",
    `with weeks as (
       select generate_series(
         date_trunc('week', now()) - interval '3 weeks',
         date_trunc('week', now()),
         interval '1 week'
       ) as week_start
     ), households as (
       select row_number() over (order by created_at, id) as household_number, id
       from public.households
       where deleted_at is null
     )
     select '| Household | ' || (select string_agg(to_char(w.week_start, 'YYYY-MM-DD') || ' | ', '' order by w.week_start) from weeks w) || E'\n' ||
            '| --- | ' || (select string_agg('---: | ', '' order by w.week_start) from weeks w) || E'\n' ||
            coalesce(string_agg(
              '| Household ' || h.household_number || ' | ' ||
              (select string_agg(count::text || ' | ', '' order by week_start)
               from (
                 select w.week_start, count(t.id) as count
                 from weeks w
                 left join public.transactions t
                   on t.household_id = h.id
                  and t.created_at >= w.week_start
                  and t.created_at < w.week_start + interval '1 week'
                 group by w.week_start
               ) weekly_counts),
              E'\n' order by h.household_number
            ), '| No active households | 0 | 0 | 0 | 0 |')
     from households h;`,
    "No active households.",
  ),
  section(
    "Activation",
    `with active_households as (
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
      ), completed_onboarding_deprecated as (
       select h.id
       from active_households h
       where exists (select 1 from public.accounts a where a.household_id = h.id and not a.is_archived)
         and exists (select 1 from public.transactions t where t.household_id = h.id)
         and exists (select 1 from public.budgets b where b.household_id = h.id)
         and (select count(*) from public.household_members m where m.household_id = h.id and m.removed_at is null) >= 2
     ), first_owners as (
       select m.household_id, m.user_id
       from public.household_members m
       where m.removed_at is null and m.role = 'owner'
     ), signup_to_first_transaction as (
       select u.id, min(t.created_at) as first_transaction_at, u.created_at as signed_up_at
       from auth.users u
       join public.household_members m on m.user_id = u.id
       join public.transactions t on t.entered_by = m.id
       group by u.id, u.created_at
     )
     select '| Metric | Value |' || E'\n| --- | ---: |' || E'\n' ||
            '| Signed-up users | ' || (select count(*) from auth.users) || ' |' || E'\n' ||
            '| Active households created | ' || (select count(*) from active_households) || ' |' || E'\n' ||
            '| Setup-complete households | ' || (select count(*) from setup_complete) || ' |' || E'\n' ||
            '| Setup-complete rate (of active households) | ' || coalesce(to_char(100.0 * (select count(*) from setup_complete) / nullif((select count(*) from active_households), 0), 'FM990.0') || '%', 'n/a') || ' |' || E'\n' ||
            '| Budget-created households | ' || (select count(*) from budget_created) || ' |' || E'\n' ||
            '| Budget-created rate (of active households) | ' || coalesce(to_char(100.0 * (select count(*) from budget_created) / nullif((select count(*) from active_households), 0), 'FM990.0') || '%', 'n/a') || ' |' || E'\n' ||
            '| Partner-joined households | ' || (select count(*) from partner_joined) || ' |' || E'\n' ||
            '| Partner-joined rate (of active households) | ' || coalesce(to_char(100.0 * (select count(*) from partner_joined) / nullif((select count(*) from active_households), 0), 'FM990.0') || '%', 'n/a') || ' |' || E'\n' ||
            '| Setup-complete → partner-joined conversion | ' || coalesce(to_char(100.0 * (select count(*) from setup_and_partner_joined) / nullif((select count(*) from setup_complete), 0), 'FM990.0') || '%', 'n/a') || ' |' || E'\n' ||
            '| Completed onboarding households (deprecated — see Definitions) | ' || (select count(*) from completed_onboarding_deprecated) || ' |' || E'\n' ||
            '| Household onboarding completion rate (deprecated) | ' || coalesce(to_char(100.0 * (select count(*) from completed_onboarding_deprecated) / nullif((select count(*) from active_households), 0), 'FM990.0') || '%', 'n/a') || ' |' || E'\n' ||
            '| Signed-up owners with completed onboarding (deprecated) | ' || (select count(distinct o.user_id) from first_owners o join completed_onboarding_deprecated c on c.id = o.household_id) || ' |' || E'\n' ||
            '| Users who entered a transaction | ' || (select count(*) from signup_to_first_transaction) || ' |' || E'\n' ||
            '| First transaction under 5 minutes | ' || (select count(*) from signup_to_first_transaction where first_transaction_at - signed_up_at < interval '5 minutes') || ' |' || E'\n' ||
            '| Under-5-minute rate among users with a transaction | ' || coalesce(to_char(100.0 * (select count(*) from signup_to_first_transaction where first_transaction_at - signed_up_at < interval '5 minutes') / nullif((select count(*) from signup_to_first_transaction), 0), 'FM990.0') || '%', 'n/a') || ' |' || E'\n' ||
            '| Median signup-to-first-transaction time | ' || coalesce((select to_char(percentile_cont(0.5) within group (order by extract(epoch from first_transaction_at - signed_up_at)) / 60.0, 'FM999999990.0') || ' minutes' from signup_to_first_transaction), 'n/a') || ' |';`,
    "No activation data.",
  ),
  section(
    "Onboarding history (recomputed under revised definitions)",
    `with snapshots(snapshot_date) as (
       values ('2026-08-20'::date), ('2026-08-22'::date), ('2026-08-24'::date), ('2026-09-03'::date)
     ), historical as (
       select
         s.snapshot_date,
         (select count(*) from public.households h where h.created_at < s.snapshot_date + interval '1 day' and (h.deleted_at is null or h.deleted_at > s.snapshot_date + interval '1 day')) as active_households,
         (select count(*) from public.households h where h.created_at < s.snapshot_date + interval '1 day' and (h.deleted_at is null or h.deleted_at > s.snapshot_date + interval '1 day')
            and exists (select 1 from public.accounts a where a.household_id = h.id and not a.is_archived and a.created_at < s.snapshot_date + interval '1 day')
            and exists (select 1 from public.transactions t where t.household_id = h.id and t.created_at < s.snapshot_date + interval '1 day')
         ) as setup_complete,
         (select count(*) from public.households h where h.created_at < s.snapshot_date + interval '1 day' and (h.deleted_at is null or h.deleted_at > s.snapshot_date + interval '1 day')
            and exists (select 1 from public.budgets b where b.household_id = h.id)
         ) as budget_created,
          (select count(*) from public.households h where h.created_at < s.snapshot_date + interval '1 day' and (h.deleted_at is null or h.deleted_at > s.snapshot_date + interval '1 day')
             and (select count(*) from public.household_members m where m.household_id = h.id and m.joined_at < s.snapshot_date + interval '1 day' and (m.removed_at is null or m.removed_at > s.snapshot_date + interval '1 day')) >= 2
          ) as partner_joined,
          (select count(*) from public.households h where h.created_at < s.snapshot_date + interval '1 day' and (h.deleted_at is null or h.deleted_at > s.snapshot_date + interval '1 day')
            and exists (select 1 from public.accounts a where a.household_id = h.id and not a.is_archived and a.created_at < s.snapshot_date + interval '1 day')
            and exists (select 1 from public.transactions t where t.household_id = h.id and t.created_at < s.snapshot_date + interval '1 day')
            and (select count(*) from public.household_members m where m.household_id = h.id and m.joined_at < s.snapshot_date + interval '1 day' and (m.removed_at is null or m.removed_at > s.snapshot_date + interval '1 day')) >= 2
          ) as setup_and_partner_joined,
          (select count(*) from public.households h where h.created_at < s.snapshot_date + interval '1 day' and (h.deleted_at is null or h.deleted_at > s.snapshot_date + interval '1 day')
             and exists (select 1 from public.accounts a where a.household_id = h.id and not a.is_archived and a.created_at < s.snapshot_date + interval '1 day')
             and exists (select 1 from public.transactions t where t.household_id = h.id and t.created_at < s.snapshot_date + interval '1 day')
             and exists (select 1 from public.budgets b where b.household_id = h.id)
             and (select count(*) from public.household_members m where m.household_id = h.id and m.joined_at < s.snapshot_date + interval '1 day' and (m.removed_at is null or m.removed_at > s.snapshot_date + interval '1 day')) >= 2
          ) as completed_deprecated
        from snapshots s
      )
      select '| As of | Active households | Setup-complete | Partner-joined | Setup→Partner conversion | Budget-created | Combined (deprecated) |' || E'\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |' || E'\n' ||
            coalesce(string_agg(
              '| ' || to_char(snapshot_date, 'YYYY-MM-DD') || ' | ' ||
              active_households || ' | ' ||
              setup_complete || ' | ' ||
              partner_joined || ' | ' ||
              coalesce(to_char(100.0 * setup_and_partner_joined / nullif(setup_complete, 0), 'FM990.0') || '%', 'n/a') || ' | ' ||
              budget_created || ' | ' ||
              completed_deprecated || ' |',
              E'\n' order by snapshot_date
            ), '| No historical snapshots | 0 | 0 | 0 | n/a | 0 | 0 |')
     from historical;`,
    "No historical onboarding data.",
  ),
  section(
    "Partner Invitations",
    `select '| Metric | Value |' || E'\n| --- | ---: |' || E'\n' ||
            '| Households that invited a partner | ' || count(distinct household_id) || ' |' || E'\n' ||
            '| Partner invitations sent | ' || count(*) || ' |' || E'\n' ||
            '| Partner invitations accepted | ' || count(*) filter (where accepted_at is not null) || ' |' || E'\n' ||
            '| Invitation acceptance rate | ' || coalesce(to_char(100.0 * count(*) filter (where accepted_at is not null) / nullif(count(*), 0), 'FM990.0') || '%', 'n/a') || ' |'
     from public.household_invites
     where role = 'partner';`,
    "No partner invitations.",
  ),
  section(
    "Retention By Household Cohort",
    `with cohorts as (
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
      select '| Signup week | Households | Week 2 active | Week 3 active | Week 4 active |' || E'\n| --- | ---: | ---: | ---: | ---: |' || E'\n' ||
            coalesce(string_agg('| ' || to_char(cohort_week, 'YYYY-MM-DD') || ' | ' || households || ' | ' || case when week_2_eligible = 0 then 'not mature' else week_2_active || ' / ' || week_2_eligible || ' (' || to_char(100.0 * week_2_active / nullif(week_2_eligible, 0), 'FM990.0') || '%)' end || ' | ' || case when week_3_eligible = 0 then 'not mature' else week_3_active || ' / ' || week_3_eligible || ' (' || to_char(100.0 * week_3_active / nullif(week_3_eligible, 0), 'FM990.0') || '%)' end || ' | ' || case when week_4_eligible = 0 then 'not mature' else week_4_active || ' / ' || week_4_eligible || ' (' || to_char(100.0 * week_4_active / nullif(week_4_eligible, 0), 'FM990.0') || '%)' end || ' |', E'\n' order by cohort_week desc), '| No active households | 0 | n/a | n/a | n/a |')
     from retention;`,
    "No retention data.",
  ),
  "## Activation Funnel — Notes on Measurability",
  "",
  "Ordered funnel: 1 — Signed up (`auth.users`), 2 — Email confirmed (`auth.users.email_confirmed_at`), 3 — Household created (`public.households`), 4 — First account created (`public.accounts` non-archived), 5 — First transaction entered (`public.transactions`), 6 — First budget created (`public.budgets`), 7 — Partner invited (`public.household_invites` role=partner), 8 — Partner accepted (`public.household_members` partner joined or `household_invites.accepted_at`). All steps are derived from existing tables — no new client-side tracking was added for this report. Steps that require client-side tracking and are **not yet derivable** are noted explicitly below rather than silently omitted: time in step (e.g., 11 min on Balances), repeat sessions before first transaction, guide-viewed (starter guide experiment), and entry point for the first transaction (empty state vs main button vs guide link). Guide viewed will be added as a funnel step between 5 and 6 when the starter guide ships, designed as an optional milestone so earlier cohorts remain comparable.",
  "",
  "Funnel time-between-steps is available from `created_at` timestamps (e.g., household → account → transaction); budget uses `period_month` as an approximation (no `created_at` on current `public.budgets`, see historical note) but precise time-in-screen and session counts require instrumentation that is not yet in the database. Entry point and guide-viewed will require a small client event table; they are placeholders in the funnel definition so adding them later does not invalidate historical furthest-step values.",
  "",
  section(
    "Activation Funnel — Drop-off (overall)",
    `with active_households as (
       select h.id from public.households h where h.deleted_at is null
     ), account_first as (
       select a.household_id, min(a.created_at) as first_account_at
       from public.accounts a
       where not a.is_archived
       group by a.household_id
     ), transaction_first as (
       select t.household_id, min(t.created_at) as first_transaction_at
       from public.transactions t
       group by t.household_id
     ), budget_first as (
       select b.household_id, min(b.period_month)::timestamptz as first_budget_at
       from public.budgets b
       group by b.household_id
     ), invite_first as (
       select i.household_id, min(i.created_at) as first_invite_at
       from public.household_invites i
       where i.role = 'partner'
       group by i.household_id
     ), partner_joined as (
       select m.household_id, min(m.joined_at) as partner_joined_at
       from public.household_members m
       where m.role = 'partner' and m.removed_at is null
       group by m.household_id
     ), funnel_counts as (
       select
         (select count(*) from auth.users) as signed_up,
         (select count(*) from auth.users where email_confirmed_at is not null) as email_confirmed,
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
         case when lag(s.reached) over (order by s.step) is null then 0 else greatest(lag(s.reached) over (order by s.step) - s.reached, 0) end as lost_at_step,
         case when lag(s.reached) over (order by s.step) is null or lag(s.reached) over (order by s.step) = 0 then '—' else to_char(100.0 * greatest(lag(s.reached) over (order by s.step) - s.reached, 0) / lag(s.reached) over (order by s.step), 'FM990.0') || '%' end as lost_pct,
         case when (select signed_up from funnel_counts) = 0 then '—' else to_char(100.0 * s.reached / (select signed_up from funnel_counts), 'FM990.0') || '%' end as cumulative_pct
       from steps s
     )
     select '| Step | Reached | Lost at step | Lost % of previous | Cumulative % of signed up |' || E'\n| --- | ---: | ---: | ---: | ---: |' || E'\n' ||
            string_agg('| ' || name || ' | ' || reached || ' | ' || lost_at_step || ' | ' || lost_pct || ' | ' || cumulative_pct || ' |', E'\n' order by step) ||
            E'\n| **Largest drop** | ' || (select name from drop_off order by lost_at_step desc, step asc limit 1) || ' | ' || (select lost_at_step from drop_off order by lost_at_step desc, step asc limit 1) || ' | ' || (select lost_pct from drop_off order by lost_at_step desc, step asc limit 1) || ' | — |'
     from drop_off;`,
    "No funnel data.",
  ),
  section(
    "Activation Funnel — Furthest Step per Household",
    `with active_households as (
       select h.id, h.created_at, row_number() over (order by h.created_at, h.id) as household_number
       from public.households h where h.deleted_at is null
     ), owner as (
       select m.household_id, min(u.created_at) as signed_up_at, min(u.email_confirmed_at) as email_confirmed_at
       from public.household_members m
       join auth.users u on u.id = m.user_id
       where m.removed_at is null and m.role = 'owner'
       group by m.household_id
     ), account_first as (
       select a.household_id, min(a.created_at) as first_account_at
       from public.accounts a where not a.is_archived group by a.household_id
     ), transaction_first as (
       select t.household_id, min(t.created_at) as first_transaction_at
       from public.transactions t group by t.household_id
     ), budget_first as (
       select b.household_id, min(b.period_month)::timestamptz as first_budget_at
       from public.budgets b group by b.household_id
     ), invite_first as (
       select i.household_id, min(i.created_at) as first_invite_at
       from public.household_invites i where i.role = 'partner' group by i.household_id
     ), partner_joined as (
       select m.household_id, min(m.joined_at) as partner_joined_at
       from public.household_members m where m.role = 'partner' and m.removed_at is null group by m.household_id
     ), household_funnel as (
       select
         h.id,
         h.household_number,
         h.created_at as household_created_at,
         o.signed_up_at,
         o.email_confirmed_at,
         a.first_account_at,
         t.first_transaction_at,
         b.first_budget_at,
         i.first_invite_at,
         p.partner_joined_at,
         case
           when p.partner_joined_at is not null then 8
           when i.first_invite_at is not null then 7
           when b.first_budget_at is not null then 6
           when t.first_transaction_at is not null then 5
           when a.first_account_at is not null then 4
           when h.created_at is not null then 3
           when o.email_confirmed_at is not null then 2
           when o.signed_up_at is not null then 1
           else 0
         end as furthest_step,
         case
           when p.partner_joined_at is not null then p.partner_joined_at
           when i.first_invite_at is not null then i.first_invite_at
           when b.first_budget_at is not null then b.first_budget_at
           when t.first_transaction_at is not null then t.first_transaction_at
           when a.first_account_at is not null then a.first_account_at
           when h.created_at is not null then h.created_at
           when o.email_confirmed_at is not null then o.email_confirmed_at
           when o.signed_up_at is not null then o.signed_up_at
           else null
         end as furthest_at,
         case
           when p.partner_joined_at is not null then '8 — Partner accepted'
           when i.first_invite_at is not null then '7 — Partner invited'
           when b.first_budget_at is not null then '6 — First budget created'
           when t.first_transaction_at is not null then '5 — First transaction entered'
           when a.first_account_at is not null then '4 — First account created'
           when h.created_at is not null then '3 — Household created'
           when o.email_confirmed_at is not null then '2 — Email confirmed'
           when o.signed_up_at is not null then '1 — Signed up'
           else '0 — Unknown'
         end as furthest_name
       from active_households h
       left join owner o on o.household_id = h.id
       left join account_first a on a.household_id = h.id
       left join transaction_first t on t.household_id = h.id
       left join budget_first b on b.household_id = h.id
       left join invite_first i on i.household_id = h.id
       left join partner_joined p on p.household_id = h.id
     )
     select '| Household | Furthest step | Reached at (UTC) | Time ago |' || E'\n| --- | --- | --- | --- |' || E'\n' ||
            coalesce(string_agg(
              '| Household ' || household_number || ' | ' || furthest_name || ' | ' || coalesce(to_char(furthest_at, 'YYYY-MM-DD HH24:MI'), '—') || ' | ' ||
              case when furthest_at is null then '—' else to_char(extract(epoch from (now() - furthest_at))/86400, 'FM990.0') || ' days ago' end || ' |',
              E'\n' order by household_number
            ), '| No active households | — | — | — |') ||
            E'\n\n**Distribution by furthest step**\n\n' ||
            '| Furthest step | Households | % of active households |' || E'\n| --- | ---: | ---: |' || E'\n' ||
            coalesce((select string_agg('| ' || furthest_name || ' | ' || cnt || ' | ' || to_char(100.0 * cnt / nullif((select count(*) from household_funnel),0), 'FM990.0') || '% |', E'\n' order by furthest_step)
              from (select furthest_step, furthest_name, count(*) as cnt from household_funnel group by furthest_step, furthest_name) s), '| — | 0 | — |') ||
            E'\n\n**Where zero-transaction households stopped**\n\n' ||
            '| Furthest step (no transaction) | Households |' || E'\n| --- | ---: |' || E'\n' ||
            coalesce((select string_agg('| ' || furthest_name || ' | ' || cnt || ' |', E'\n' order by furthest_step)
              from (select furthest_step, furthest_name, count(*) as cnt from household_funnel where first_transaction_at is null group by furthest_step, furthest_name) z), '| All households have a transaction | 0 |')
     from household_funnel;`,
    "No funnel data.",
  ),
  section(
    "Activation Funnel by Cohort (household created week)",
    `with active_households as (
       select h.id, h.created_at, date_trunc('week', h.created_at) as cohort_week
       from public.households h where h.deleted_at is null
     ), owner as (
       select m.household_id, min(u.created_at) as signed_up_at, min(u.email_confirmed_at) as email_confirmed_at
       from public.household_members m join auth.users u on u.id = m.user_id where m.removed_at is null and m.role = 'owner' group by m.household_id
     ), account_first as (
       select a.household_id, min(a.created_at) as first_account_at from public.accounts a where not a.is_archived group by a.household_id
     ), transaction_first as (
       select t.household_id, min(t.created_at) as first_transaction_at from public.transactions t group by t.household_id
     ), budget_first as (
       select b.household_id, min(b.period_month)::timestamptz as first_budget_at from public.budgets b group by b.household_id
     ), invite_first as (
       select i.household_id, min(i.created_at) as first_invite_at from public.household_invites i where i.role = 'partner' group by i.household_id
     ), partner_joined as (
       select m.household_id, min(m.joined_at) as partner_joined_at from public.household_members m where m.role = 'partner' and m.removed_at is null group by m.household_id
     ), household_funnel as (
       select h.id, h.cohort_week, h.created_at,
         o.signed_up_at, o.email_confirmed_at, a.first_account_at, t.first_transaction_at, b.first_budget_at, i.first_invite_at, p.partner_joined_at,
         case when p.partner_joined_at is not null then 8 when i.first_invite_at is not null then 7 when b.first_budget_at is not null then 6 when t.first_transaction_at is not null then 5 when a.first_account_at is not null then 4 when h.created_at is not null then 3 when o.email_confirmed_at is not null then 2 when o.signed_up_at is not null then 1 else 0 end as furthest_step
       from active_households h
       left join owner o on o.household_id = h.id
       left join account_first a on a.household_id = h.id
       left join transaction_first t on t.household_id = h.id
       left join budget_first b on b.household_id = h.id
       left join invite_first i on i.household_id = h.id
       left join partner_joined p on p.household_id = h.id
      ), cohorts as (
        select cohort_week, count(*) as households,
          count(*) filter (where first_account_at is not null) as with_account,
          count(*) filter (where first_transaction_at is not null) as with_transaction,
          count(*) filter (where first_budget_at is not null) as with_budget,
          count(*) filter (where first_invite_at is not null) as invited,
          count(*) filter (where partner_joined_at is not null) as accepted
        from household_funnel group by cohort_week
      )
     select '| Cohort (week of household created) | Households | With account | With transaction | With budget | Partner invited | Partner accepted |' || E'\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |' || E'\n' ||
            coalesce(string_agg(
              '| ' || to_char(cohort_week, 'YYYY-MM-DD') || ' | ' || households || ' | ' ||
              with_account || ' (' || to_char(100.0 * with_account / nullif(households,0), 'FM990.0') || '%) | ' ||
              with_transaction || ' (' || to_char(100.0 * with_transaction / nullif(households,0), 'FM990.0') || '%) | ' ||
              with_budget || ' (' || to_char(100.0 * with_budget / nullif(households,0), 'FM990.0') || '%) | ' ||
              invited || ' (' || to_char(100.0 * invited / nullif(households,0), 'FM990.0') || '%) | ' ||
              accepted || ' (' || to_char(100.0 * accepted / nullif(households,0), 'FM990.0') || '%) |',
              E'\n' order by cohort_week desc
            ), '| No cohorts | 0 | — | — | — | — | — |')
     from cohorts;`,
    "No cohort funnel data.",
  ),
  section(
    "Both Members Active",
    `with weeks as (
       select generate_series(date_trunc('week', now()) - interval '3 weeks', date_trunc('week', now()), interval '1 week') as week_start
     ), household_activity as (
       select w.week_start, t.household_id, count(distinct t.entered_by) as active_members
       from weeks w
       join public.transactions t on t.created_at >= w.week_start and t.created_at < w.week_start + interval '1 week'
       group by w.week_start, t.household_id
     ), weekly_activity as (
       select w.week_start,
              count(a.household_id) as active_households,
              count(a.household_id) filter (where a.active_members >= 2) as both_members_active
       from weeks w
       left join household_activity a on a.week_start = w.week_start
       group by w.week_start
     )
     select '| Week starting | Active households | Households with both members entering transactions | Rate |' || E'\n| --- | ---: | ---: | ---: |' || E'\n' ||
            string_agg('| ' || to_char(week_start, 'YYYY-MM-DD') || ' | ' || active_households || ' | ' || both_members_active || ' | ' || coalesce(to_char(100.0 * both_members_active / nullif(active_households, 0), 'FM990.0') || '%', 'n/a') || ' |', E'\n' order by week_start)
     from weekly_activity;`,
    "No member activity data.",
  ),
  "## Qualitative Feedback",
  "",
  "Feedback reports are delivered by email through Resend and are not persisted in the database. This database-only report cannot enumerate reports or summarize answers to the qualitative questions. Export or archive the feedback mailbox separately, then attach that source to the evaluation.",
  "",
  "## Definitions",

  "- Setup-complete: an active household has at least one non-archived account and at least one transaction. No member-count condition — a solo household that is fully set up counts as setup-complete.",
  "- Budget-created: an active household has at least one budget. This is a separate, later milestone (tracking → planning) and is not required for setup-complete. Historical budget counts are approximate because the current budget table has no creation timestamp.",
  "- Partner-joined: an active household has two or more active members.",
  "- Setup-complete → partner-joined conversion: households that are both setup-complete **and** partner-joined divided by setup-complete (funnel conversion; `partner_joined` alone is reported separately so this never exceeds 100%). n/a when no household is setup-complete.",
  "- Completed onboarding (deprecated): the previous combined definition — at least one non-archived account, one transaction, one budget, and two active members. Kept for continuity; use setup-complete and partner-joined for new analysis.",
  "- Active household (for weekly activity): a household with at least one transaction entered during the specified week.",
  "- Both members active: at least two distinct household members entered transactions during the specified week.",
  "- Retention cohort: households grouped by the UTC week in which the household was created. Week 2, 3, and 4 are each measured in their respective seven-day interval after creation. The denominator for each percentage is the number of cohort households whose retention window has fully elapsed (eligible): `week_N_eligible = count(*) filter (where now() >= created_at + N weeks)`. The table shows `active / eligible (rate%)` so `rate = 100 * active / eligible`; `not mature` means eligible = 0 (window not yet elapsed). This makes every percentage reproducible from the two numbers visible in the same cell.",
  "- Historical recomputation (08-20, 08-22, 08-24, 09-03): each snapshot counts households `created_at < snapshot + 1 day` and not deleted at end-of-day (`deleted_at is null or deleted_at > snapshot + 1 day`), and checks accounts/transactions/membership with `created_at < snapshot + 1 day` and `removed_at` as of the snapshot, so the trend is comparable under the revised definitions. `is_archived` reflects current archival state (no archived_at timestamp exists) and `budget_created` has no creation timestamp — both historical values are approximations, documented as such.",
  "- Activation funnel: ordered steps 1 Signed up → 2 Email confirmed → 3 Household created → 4 First account created → 5 First transaction entered → 6 First budget created → 7 Partner invited → 8 Partner accepted. Furthest step per household is the highest step whose timestamp exists (exactly one step per household). Drop-off Lost at step = previous reached − current reached. Time in step, repeat sessions, guide-viewed, and entry point for first transaction require client-side event tracking not yet in the database (see funnel notes); adding guide-viewed between 5 and 6 later will not change historic furthest-step values because steps are named, not renumbered.",
  "",
].join("\n");

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, report, "utf8");
console.log(`Metrics report written to ${path.relative(process.cwd(), outputPath)}`);
