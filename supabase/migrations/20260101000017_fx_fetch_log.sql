-- Issue #17: run-outcome log for the daily FX fetch. Every refresh (cron or
-- manual Settings button) writes one row, so a broken integration is visible
-- instead of silently falling back to older rates for weeks. The stale-rate
-- warning in Settings reads fx_rates (already RLS-readable); this table is
-- the audit trail for diagnosing *why* a run failed.

create table public.fx_fetch_log (
  id        uuid primary key default gen_random_uuid(),
  ran_at    timestamptz not null default now(),
  rate_date date        not null,
  outcome   text        not null check (outcome in ('success', 'failed')),
  inserted  int         not null default 0,
  updated   int         not null default 0,
  skipped   int         not null default 0,
  error     text
);

create index fx_fetch_log_ran_at_idx on public.fx_fetch_log (ran_at desc);

-- Closed table, mirroring invite_sends (migration 16): the service role writes
-- it from the route handler; anon/authenticated get nothing and RLS carries
-- no policies. With `auto_expose_new_tables` off (config.toml), the explicit
-- grant is what makes the table reachable through the data API at all.
grant select, insert on public.fx_fetch_log to service_role;

-- The refresh handlers write fx_rates and read currencies with the service
-- role through the data API. Both tables were granted only to
-- anon/authenticated (migrations 11/12), so with auto-exposure off the
-- service role gets "permission denied" — the upsert needs explicit grants.
grant select, insert, update on public.fx_rates to service_role;
grant select on public.currencies to service_role;

alter table public.fx_fetch_log enable row level security;

comment on table public.fx_fetch_log is
  'One row per FX refresh run (cron or manual). outcome distinguishes success from failure so a missing day of rates is diagnosable.';
comment on column public.fx_fetch_log.error is 'Failure message when outcome = failed.';
