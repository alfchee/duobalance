-- Issue #265: dunning delivery ledger (epic #255 Phase A).
--
-- The dunning job (src/lib/billing/dunning.ts, driven by the billing-dunning
-- cron) sends one email per stage (first_reminder, second_reminder,
-- final_notice) to households whose subscription sits in past_due/grace.
-- Email delivery is not naturally idempotent — a retried job would resend —
-- so every send is recorded here first-or-together with a UNIQUE
-- (subscription_id, stage) guard: a second run in the same minute finds the
-- row and skips the send. The same event twice sends once.
--
-- Scope notes:
-- - This table is the dunning job's send ledger only. Provider webhook
--   deliveries keep living in billing_events (unique on
--   (provider, provider_event_id)) — the two dedupe domains must not share
--   rows, since lifecycle.ts explicitly never writes billing_events itself.
-- - A recovered subscription (payment.succeeded → active) clears its rows
--   via clearDunningForSubscription() so a LATER failure cycle re-sends
--   from stage 1. Without the clear, the old rows would suppress the new
--   cycle's first reminder.
-- - Comped subscriptions never get rows: the job skips
--   plan_code = 'comped' before any send (asserted in
--   src/lib/billing/dunning.test.ts by advancing the clock a year).
-- - Writes are service-role only (the cron job); households read their own
--   rows via RLS so a future "billing notices" UI can list them.

create table public.dunning_deliveries (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  household_id    uuid not null references public.households(id) on delete cascade,
  stage           text not null check (stage in
                    ('first_reminder', 'second_reminder', 'final_notice')),
  sent_at         timestamptz not null default now(),
  unique (subscription_id, stage)
);

create index dunning_deliveries_household_idx
  on public.dunning_deliveries (household_id);

alter table public.dunning_deliveries enable row level security;

-- A household reads only its own delivery rows. No insert/update/delete
-- policies: sends are recorded by the service-role cron job only.
create policy dunning_deliveries_select_own_household
  on public.dunning_deliveries for select to authenticated
  using (public.is_member(household_id));

comment on table public.dunning_deliveries is
  'Issue #265: one row per (subscription, dunning stage) sent. Unique guard makes the billing-dunning cron idempotent; cleared on recovery so a later failure cycle restarts at stage 1. Writes are service-role only.';
comment on column public.dunning_deliveries.stage is
  'Dunning stage sent: first_reminder (past_due entry), second_reminder (grace entry), final_notice (grace window nearly over).';

grant select on public.dunning_deliveries to authenticated;
-- No grants to anon; no write grants to authenticated (service_role bypasses RLS).
