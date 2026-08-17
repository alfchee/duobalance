-- Issue #33: tests for reminded_at column, bill_instance_generation_bounds RPC,
-- and bill_instances_due_for_reminder RPC.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(17);

do $$
declare
  household_a uuid := 'f0000000-0000-0000-0000-000000000001';
  owner_user uuid := 'f1000000-0000-0000-0000-000000000001';
  partner_user uuid := 'f1000000-0000-0000-0000-000000000002';
  owner_member uuid := 'f2000000-0000-0000-0000-000000000001';
  partner_member uuid := 'f2000000-0000-0000-0000-000000000002';
  bill_id uuid := 'f5000000-0000-0000-0000-000000000001';
  instance_id uuid := 'f6000000-0000-0000-0000-000000000001';
begin
  insert into auth.users (id, email) values
    (owner_user, 'owner33@test.local'),
    (partner_user, 'partner33@test.local');

  insert into public.households (id, name, country, base_currency, timezone, locale) values
    (household_a, 'Reminder Test', 'NI', 'USD', 'America/Managua', 'es');

  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_member, household_a, owner_user, 'owner', 'Owner'),
    (partner_member, household_a, partner_user, 'partner', 'Partner');

  insert into public.accounts (id, household_id, name, kind, currency) values
    ('f3000000-0000-0000-0000-000000000001', household_a, 'Account', 'checking', 'USD');

  insert into public.categories (id, household_id, name) values
    ('f4000000-0000-0000-0000-000000000001', household_a, 'Bills');
end
$$;

-- 1: reminded_at column exists on bill_instances
select has_column('public', 'bill_instances', 'reminded_at', 'bill_instances has reminded_at column');

-- 2: bill_instance_generation_bounds function exists
select has_function('public', 'bill_instance_generation_bounds', 'bill_instance_generation_bounds function exists');

-- 3: bill_instances_due_for_reminder function exists
select has_function('public', 'bill_instances_due_for_reminder', 'bill_instances_due_for_reminder function exists');

-- Set up a bill and instances for generation tests
do $$
declare
  household_a uuid := 'f0000000-0000-0000-0000-000000000001';
  bill_id uuid := 'f5000000-0000-0000-0000-000000000001';
begin
  insert into public.bills (id, household_id, name, currency, default_amount, rrule, starts_on, reminder_days_before)
    values (bill_id, household_a, 'Monthly Rent', 'USD', 1000, 'FREQ=MONTHLY;BYMONTHDAY=15', current_date - interval '3 months', 3);
end
$$;

select tests.clear_auth();

-- 4: generation bounds returns data for active bill
select isnt_empty(
  $$ select * from public.bill_instance_generation_bounds('f5000000-0000-0000-0000-000000000001') $$,
  'generation bounds returns rows for active bill'
);

-- 5: generation bounds horizon_start is after the last instance (none yet = starts_on)
select results_eq(
  $$ select horizon_start from public.bill_instance_generation_bounds('f5000000-0000-0000-0000-000000000001') $$,
  $$ values ((current_date - interval '3 months')::date) $$,
  'horizon_start equals starts_on when no instances exist'
);

-- 6: generation bounds horizon_end is 12 months from now
select results_eq(
  $$ select horizon_end from public.bill_instance_generation_bounds('f5000000-0000-0000-0000-000000000001') $$,
  $$ values ((current_date + interval '12 months')::date) $$,
  'horizon_end is today + 12 months'
);

-- Insert a past instance to test horizon_start logic
insert into public.bill_instances (bill_id, household_id, due_on, amount)
  values ('f5000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
          current_date - interval '2 months', 1000);

-- 7: horizon_start moves past the last existing instance
select results_eq(
  $$ select horizon_start from public.bill_instance_generation_bounds('f5000000-0000-0000-0000-000000000001') $$,
  $$ values ((current_date - interval '2 months' + interval '1 day')::date) $$,
  'horizon_start is day after latest instance due_on'
);

-- Insert a more recent instance
insert into public.bill_instances (bill_id, household_id, due_on, amount)
  values ('f5000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
          current_date - interval '1 month', 1000);

-- 8: horizon_start uses the latest instance due_on
select results_eq(
  $$ select horizon_start from public.bill_instance_generation_bounds('f5000000-0000-0000-0000-000000000001') $$,
  $$ values ((current_date - interval '1 month' + interval '1 day')::date) $$,
  'horizon_start uses the most recent instance'
);

-- Test reminded_at on bill_instances
select tests.authenticate_as('f1000000-0000-0000-0000-000000000001');

-- Insert an instance with a known ID for the reminded_at test.
-- Use a due_on that does not conflict with existing auto-inserted rows.
insert into public.bill_instances (id, bill_id, household_id, due_on, amount)
  values ('f6000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001',
          'f0000000-0000-0000-0000-000000000001',
          (current_date - interval '2 months' + interval '1 day')::date, 1000);

-- 9: reminded_at can be set on an instance
select lives_ok(
  $$ update public.bill_instances
     set reminded_at = now()
     where id = 'f6000000-0000-0000-0000-000000000001' $$,
  'reminded_at can be updated'
);

-- 10: reminded_at persists
select results_eq(
  $$ select reminded_at is not null from public.bill_instances
     where id = 'f6000000-0000-0000-0000-000000000001' $$,
  $$ values (true) $$,
  'reminded_at value persists after update'
);

select tests.clear_auth();

-- Test bill_instances_due_for_reminder: create a due instance with reminder window open
insert into public.bill_instances (bill_id, household_id, due_on, amount)
  values ('f5000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
          current_date + 1, 1000);

-- 11: due_for_reminder returns the instance due tomorrow (3-day reminder window)
select isnt_empty(
  $$ select * from public.bill_instances_due_for_reminder() $$,
  'due for reminder returns instances in the reminder window'
);

-- 12: due_for_reminder includes bill and household data
select set_has(
  $$ select bill_name from public.bill_instances_due_for_reminder() $$,
  $$ values ('Monthly Rent'::text) $$,
  'reminder includes the bill name'
);

-- Check the reminded instance is excluded
-- 13: already-reminded instances are excluded
select is_empty(
  $$ select * from public.bill_instances_due_for_reminder()
     where instance_id = 'f6000000-0000-0000-0000-000000000001' $$,
  'reminded instances are excluded from due_for_reminder'
);

-- A soft-deleted household must stop generating reminders immediately —
-- otherwise members keep getting emails/push for the full 30-day purge
-- window (#128 review finding).
update public.households
  set deleted_at = now()
  where id = 'f0000000-0000-0000-0000-000000000001';

-- 13b: due_for_reminder excludes instances of a soft-deleted household
select is_empty(
  $$ select * from public.bill_instances_due_for_reminder()
     where household_id = 'f0000000-0000-0000-0000-000000000001' $$,
  'soft-deleted households are excluded from due_for_reminder'
);

update public.households
  set deleted_at = null
  where id = 'f0000000-0000-0000-0000-000000000001';

-- Test ends_on behavior: create a bill with ends_on in the past
do $$
declare
  household_a uuid := 'f0000000-0000-0000-0000-000000000001';
  ended_bill_id uuid := 'f5000000-0000-0000-0000-000000000002';
begin
  insert into public.bills (id, household_id, name, currency, default_amount, rrule, starts_on, ends_on, is_active)
    values (ended_bill_id, household_a, 'Expired', 'USD', 500, 'FREQ=MONTHLY', current_date - interval '6 months', current_date - interval '1 month', false);
end
$$;

-- 14: inactive bill is not returned by generation bounds
select is_empty(
  $$ select * from public.bill_instance_generation_bounds('f5000000-0000-0000-0000-000000000002') $$,
  'generation bounds returns nothing for inactive bill'
);

-- ============================================================================
-- get_user_emails_batch is SECURITY DEFINER over auth.users — it must be
-- unreachable by anon/authenticated (which would let any client harvest
-- arbitrary users' emails) and reachable only by service_role, which is
-- what the send-bill-reminders cron handler authenticates as.
-- ============================================================================

select tests.authenticate_as('f1000000-0000-0000-0000-000000000001');

-- 15: authenticated has no EXECUTE grant on get_user_emails_batch
select throws_ok(
  $$ select * from public.get_user_emails_batch(array['f1000000-0000-0000-0000-000000000001'::uuid]) $$,
  '42501',
  null,
  'authenticated cannot call get_user_emails_batch'
);

select tests.authenticate_anon();

-- 16: anon has no EXECUTE grant on get_user_emails_batch
select throws_ok(
  $$ select * from public.get_user_emails_batch(array['f1000000-0000-0000-0000-000000000001'::uuid]) $$,
  '42501',
  null,
  'anon cannot call get_user_emails_batch'
);

select * from finish();
rollback;