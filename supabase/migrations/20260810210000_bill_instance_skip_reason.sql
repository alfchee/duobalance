alter table public.bill_instances
  add column skip_reason text;

alter table public.bill_instances
  add constraint bill_instances_skip_reason_matches_status check (
    status = 'skipped' or skip_reason is null
  );
