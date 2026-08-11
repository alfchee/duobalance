\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(3);

do $$
declare
  household_id uuid := 'e0000000-0000-0000-0000-000000000001';
  user_id uuid := 'e1000000-0000-0000-0000-000000000001';
  member_id uuid := 'e2000000-0000-0000-0000-000000000001';
  bill_id uuid := 'e5000000-0000-0000-0000-000000000001';
begin
  insert into auth.users (id, email) values (user_id, 'skip34@test.local');
  insert into public.households (id, name, country, base_currency, timezone) values
    (household_id, 'Skip test', 'NI', 'USD', 'America/Managua');
  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (member_id, household_id, user_id, 'owner', 'Owner');
  insert into public.bills (id, household_id, name, currency, rrule, starts_on) values
    (bill_id, household_id, 'Test bill', 'USD', 'FREQ=MONTHLY', current_date);
end
$$;

select tests.authenticate_as('e1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ insert into public.bill_instances (household_id, bill_id, due_on, amount, status, skip_reason)
     values ('e0000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', current_date, 100, 'skipped', 'Not subscribed this month') $$,
  'skipped instance accepts an optional reason'
);

select results_eq(
  $$ select skip_reason from public.bill_instances where bill_id = 'e5000000-0000-0000-0000-000000000001' $$,
  $$ values ('Not subscribed this month'::text) $$,
  'skip reason persists'
);

select throws_ok(
  $$ insert into public.bill_instances (household_id, bill_id, due_on, amount, skip_reason)
     values ('e0000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', current_date + 1, 100, 'invalid outside skipped') $$,
  '23514', null, 'skip reason is rejected unless status is skipped'
);

select * from finish();
rollback;
