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
      "Unable to run psql. Install PostgreSQL client tools and set DATABASE_URL for a non-local database.",
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
     ), completed_onboarding as (
       select h.id
       from active_households h
       where exists (select 1 from public.accounts a where a.household_id = h.id and not a.is_archived)
         and exists (select 1 from public.transactions t where t.household_id = h.id)
         and exists (select 1 from public.budgets b where b.household_id = h.id)
         and (select count(*) from public.household_members m where m.household_id = h.id and m.removed_at is null) >= 2
     ), first_owners as (
       select distinct on (m.household_id) m.household_id, m.user_id
       from public.household_members m
       where m.removed_at is null
       order by m.household_id, m.joined_at, m.id
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
            '| Completed onboarding households | ' || (select count(*) from completed_onboarding) || ' |' || E'\n' ||
            '| Household onboarding completion rate | ' || coalesce(to_char(100.0 * (select count(*) from completed_onboarding) / nullif((select count(*) from active_households), 0), 'FM990.0') || '%', 'n/a') || ' |' || E'\n' ||
            '| Signed-up owners with completed onboarding | ' || (select count(*) from first_owners o join completed_onboarding c on c.id = o.household_id) || ' |' || E'\n' ||
            '| Users who entered a transaction | ' || (select count(*) from signup_to_first_transaction) || ' |' || E'\n' ||
            '| First transaction under 5 minutes | ' || (select count(*) from signup_to_first_transaction where first_transaction_at - signed_up_at < interval '5 minutes') || ' |' || E'\n' ||
            '| Under-5-minute rate among users with a transaction | ' || coalesce(to_char(100.0 * (select count(*) from signup_to_first_transaction where first_transaction_at - signed_up_at < interval '5 minutes') / nullif((select count(*) from signup_to_first_transaction), 0), 'FM990.0') || '%', 'n/a') || ' |' || E'\n' ||
            '| Median signup-to-first-transaction time | ' || coalesce((select to_char(percentile_cont(0.5) within group (order by extract(epoch from first_transaction_at - signed_up_at)) / 60.0, 'FM999999990.0') || ' minutes' from signup_to_first_transaction), 'n/a') || ' |';`,
    "No activation data.",
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
       select id, date_trunc('week', created_at) as cohort_week
       from public.households
       where deleted_at is null
     ), retention as (
       select cohort_week,
              count(*) as households,
              count(*) filter (where now() >= cohort_week + interval '2 weeks' and exists (select 1 from public.transactions t where t.household_id = c.id and t.created_at >= cohort_week + interval '1 week' and t.created_at < cohort_week + interval '2 weeks')) as week_2_active,
              count(*) filter (where now() >= cohort_week + interval '3 weeks' and exists (select 1 from public.transactions t where t.household_id = c.id and t.created_at >= cohort_week + interval '2 weeks' and t.created_at < cohort_week + interval '3 weeks')) as week_3_active,
              count(*) filter (where now() >= cohort_week + interval '4 weeks' and exists (select 1 from public.transactions t where t.household_id = c.id and t.created_at >= cohort_week + interval '3 weeks' and t.created_at < cohort_week + interval '4 weeks')) as week_4_active
       from cohorts c
       group by cohort_week
     )
     select '| Signup week | Households | Week 2 active | Week 3 active | Week 4 active |' || E'\n| --- | ---: | ---: | ---: | ---: |' || E'\n' ||
            coalesce(string_agg('| ' || to_char(cohort_week, 'YYYY-MM-DD') || ' | ' || households || ' | ' || case when now() < cohort_week + interval '2 weeks' then 'not mature' else week_2_active || ' (' || to_char(100.0 * week_2_active / households, 'FM990.0') || '%)' end || ' | ' || case when now() < cohort_week + interval '3 weeks' then 'not mature' else week_3_active || ' (' || to_char(100.0 * week_3_active / households, 'FM990.0') || '%)' end || ' | ' || case when now() < cohort_week + interval '4 weeks' then 'not mature' else week_4_active || ' (' || to_char(100.0 * week_4_active / households, 'FM990.0') || '%)' end || ' |', E'\n' order by cohort_week desc), '| No active households | 0 | n/a | n/a | n/a |')
     from retention;`,
    "No retention data.",
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
  "",
  "- Completed onboarding: an active household has at least one non-archived account, transaction, budget, and two active members.",
  "- Active household: a household with at least one transaction entered during the specified week.",
  "- Both members active: at least two distinct household members entered transactions during the specified week.",
  "- Retention cohort: households grouped by the UTC week in which the household was created. Week 2, 3, and 4 are each measured in their respective seven-day interval after creation.",
  "",
].join("\n");

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, report, "utf8");
console.log(`Metrics report written to ${path.relative(process.cwd(), outputPath)}`);
