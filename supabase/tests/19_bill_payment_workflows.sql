\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(12);

do $$
declare
  household_id uuid := 'd0000000-0000-0000-0000-000000000001';
  owner_user_id uuid := 'd1000000-0000-0000-0000-000000000001';
  partner_user_id uuid := 'd1000000-0000-0000-0000-000000000002';
  owner_member_id uuid := 'd2000000-0000-0000-0000-000000000001';
  partner_member_id uuid := 'd2000000-0000-0000-0000-000000000002';
  account_id uuid := 'd3000000-0000-0000-0000-000000000001';
  category_id uuid := 'd4000000-0000-0000-0000-000000000001';
  bill_id uuid := 'd5000000-0000-0000-0000-000000000001';
begin
  insert into auth.users (id, email) values
    (owner_user_id, 'owner34@test.local'),
    (partner_user_id, 'partner34@test.local');
  insert into public.households (id, name, country, base_currency, timezone) values
    (household_id, 'Payment test', 'US', 'USD', 'America/New_York');
  insert into public.household_members (id, household_id, user_id, role, display_name) values
    (owner_member_id, household_id, owner_user_id, 'owner', 'Owner'),
    (partner_member_id, household_id, partner_user_id, 'partner', 'Partner');
  insert into public.accounts (id, household_id, name, kind, currency) values
    (account_id, household_id, 'USD account', 'checking', 'USD');
  insert into public.categories (id, household_id, name, kind) values
    (category_id, household_id, 'Bills', 'expense');
  insert into public.bills (id, household_id, name, account_id, category_id, currency, rrule, starts_on) values
    (bill_id, household_id, 'Electricity', account_id, category_id, 'USD', 'FREQ=MONTHLY', current_date);
  insert into public.bill_instances (id, household_id, bill_id, due_on, amount) values
    ('d6000000-0000-0000-0000-000000000001', household_id, bill_id, current_date, 42.5);
end
$$;

select tests.authenticate_as('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$ select public.pay_bill_instance(
       'd6000000-0000-0000-0000-000000000001', 45, current_date,
       'd2000000-0000-0000-0000-000000000002', true
     ) $$,
  'partner can atomically pay a bill instance and create its transaction'
);

select results_eq(
  $$ select status, paid_by_member_id from public.bill_instances
     where id = 'd6000000-0000-0000-0000-000000000001' $$,
  $$ values ('paid'::text, 'd2000000-0000-0000-0000-000000000002'::uuid) $$,
  'payment records paid status and the credited partner'
);

select results_eq(
  $$ select amount::numeric, currency::text, fx_rate::numeric, spent_by from public.transactions
     where description = 'Electricity' $$,
  $$ values (-45::numeric, 'USD'::text, 1::numeric, 'd2000000-0000-0000-0000-000000000002'::uuid) $$,
  'linked transaction uses account currency and a valid base-currency rate'
);

select results_eq(
  $$ select count(*)::integer from public.bill_instances
     where id = 'd6000000-0000-0000-0000-000000000001'
       and paid_transaction_id is not null $$,
  $$ values (1::integer) $$,
  'paid instance links to the created transaction'
);

select lives_ok(
  $$ select public.unmark_bill_instance_paid('d6000000-0000-0000-0000-000000000001') $$,
  'unmarking payment completes atomically'
);

select results_eq(
  $$ select status, paid_on, paid_by_member_id, paid_transaction_id from public.bill_instances
     where id = 'd6000000-0000-0000-0000-000000000001' $$,
  $$ values ('due'::text, null::date, null::uuid, null::uuid) $$,
  'unmarking restores the due instance and clears payment fields'
);

select is_empty(
  $$ select * from public.transactions where description = 'Electricity' $$,
  'unmarking removes the linked transaction'
);

select tests.clear_auth();

select throws_ok(
  $$ select public.pay_bill_instance(
       'd6000000-0000-0000-0000-000000000001', 0, current_date,
       'd2000000-0000-0000-0000-000000000002', false
     ) $$,
  '23514', null, 'non-positive payment amounts are rejected'
);

select tests.authenticate_as('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$ select public.pay_bill_instance(
       'd6000000-0000-0000-0000-000000000001', 45, current_date,
       'd2000000-0000-0000-0000-000000000002', false
     ) $$,
  'a payment can be recorded without creating a ledger transaction'
);

select results_eq(
  $$ select status, paid_transaction_id from public.bill_instances
     where id = 'd6000000-0000-0000-0000-000000000001' $$,
  $$ values ('paid'::text, null::uuid) $$,
  'a payment without a transaction leaves no ledger link'
);

select lives_ok(
  $$ select public.unmark_bill_instance_paid('d6000000-0000-0000-0000-000000000001') $$,
  'a payment without a transaction can be unmarked'
);

do $$
begin
  update public.bills
  set currency = 'NIO'
  where id = 'd5000000-0000-0000-0000-000000000001';
end
$$;

select throws_ok(
  $$ select public.pay_bill_instance(
       'd6000000-0000-0000-0000-000000000001', 45, current_date,
       'd2000000-0000-0000-0000-000000000002', true
     ) $$,
  '23514', 'bill currency must match its payment account currency',
  'ledger creation rejects a bill in a different currency from its account'
);

select * from finish();
rollback;
