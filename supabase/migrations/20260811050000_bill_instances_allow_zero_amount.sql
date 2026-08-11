-- Variable-amount bills (bills.default_amount is null) previously could never
-- get generated instances: generateInstancesForBill skipped them entirely
-- because bill_instances.amount was `not null check (amount > 0)`, so there
-- was no value to insert. Relax the check to allow zero — the cron generates
-- these instances with amount = 0, and the existing per-instance amount
-- editor in bills-view.tsx lets the household fill in the real amount before
-- paying. pay_bill_instance still independently requires its own p_amount
-- argument to be positive, so this does not weaken payment validation.
alter table public.bill_instances
  drop constraint bill_instances_amount_check,
  add constraint bill_instances_amount_check check (amount >= 0);

comment on column public.bill_instances.amount is 'Defaults to 0 for variable-amount bills until the household fills in the actual amount; pay_bill_instance always requires a positive amount to record a payment.';
