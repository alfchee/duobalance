-- Issue #33: bill instance reminded_at tracking and helper functions
-- for the cron-driven instance generation and reminder route handlers.

-- Track whether a reminder has been sent for a given instance.
alter table public.bill_instances
  add column reminded_at timestamptz;

comment on column public.bill_instances.reminded_at is 'Set by the send-bill-reminders cron to prevent duplicate reminders.';

-- Helper: expand an RRULE into a set of due dates for a bill.
-- Takes the rrule text, the start date, optional end date, and a horizon
-- (default: today + 12 months). Returns dates strictly after the last
-- existing instance due_on (or starts_on - 1 day if none exist).
--
-- This is a server-side helper used by the generate-bill-instances cron.
-- The actual rrule parsing happens in TypeScript (the rrule npm library);
-- the SQL side just provides the query building block.
create or replace function public.bill_instance_generation_bounds(
  p_bill_id uuid
)
returns table(
  horizon_start date,
  horizon_end   date,
  starts_on     date,
  ends_on       date,
  rrule         text,
  default_amount numeric(20,4)
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(
      (select max(bi.due_on) from public.bill_instances bi where bi.bill_id = p_bill_id),
      b.starts_on - 1
    ) + 1 as horizon_start,
    (current_date + interval '12 months')::date as horizon_end,
    b.starts_on,
    b.ends_on,
    b.rrule,
    b.default_amount
  from public.bills b
  where b.id = p_bill_id and b.is_active;
$$;

comment on function public.bill_instance_generation_bounds is 'Returns the rrule, amount, and date bounds for generating new instances of a bill. Used by the /api/cron/generate-bill-instances route handler.';

-- Helper: find bill instances due soon enough that a reminder should be sent.
-- Returns rows joined with bill + household data needed to send the email.
create or replace function public.bill_instances_due_for_reminder()
returns table(
  instance_id       uuid,
  bill_id           uuid,
  household_id      uuid,
  due_on            date,
  amount            numeric(20,4),
  bill_name         text,
  currency          text,
  responsible_member_id uuid,
  household_name    text,
  household_timezone text,
  household_locale  text
)
language sql
stable
set search_path = public
as $$
  select
    bi.id,
    bi.bill_id,
    bi.household_id,
    bi.due_on,
    bi.amount,
    b.name,
    b.currency,
    b.responsible_member_id,
    h.name,
    h.timezone,
    h.locale
  from public.bill_instances bi
  join public.bills b on b.id = bi.bill_id
  join public.households h on h.id = bi.household_id
  where bi.status = 'due'
    and bi.reminded_at is null
    and bi.due_on - b.reminder_days_before <= (now() at time zone h.timezone)::date
    and b.is_active;
$$;

comment on function public.bill_instances_due_for_reminder is 'Returns unpaid, un-reminded bill instances whose reminder window has opened. Used by the /api/cron/send-bill-reminders route handler.';

-- Helper: batch-fetch user emails from auth.users given an array of user IDs.
-- SECURITY DEFINER so the service-role cron handler can read auth.users through
-- the PostgREST RPC interface without listing every user in the system.
-- v1.3 – add batch email lookup for reminder delivery
create or replace function public.get_user_emails_batch(p_user_ids uuid[])
returns table(id uuid, email text)
language sql
stable
security definer
set search_path = auth
as $$
  select u.id::uuid, u.email::text
  from auth.users u
  where u.id = any (p_user_ids);
$$;

comment on function public.get_user_emails_batch is 'Returns id/email pairs for the given user IDs from auth.users. Used by the send-bill-reminders cron handler.';

-- Postgres grants EXECUTE on new functions to PUBLIC by default. This function
-- is SECURITY DEFINER and reads auth.users directly, bypassing RLS entirely —
-- left at the default grant, any anon/authenticated client could call the
-- PostgREST RPC with arbitrary user IDs and harvest emails for the whole
-- system. Only the service-role cron handler should ever reach it.
revoke all on function public.get_user_emails_batch(uuid[]) from public;
grant execute on function public.get_user_emails_batch(uuid[]) to service_role;
