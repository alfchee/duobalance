alter table public.fx_fetch_log rename column ran_at to fetched_at;
alter table public.fx_fetch_log rename column rate_date to fetch_date;
alter table public.fx_fetch_log rename column outcome to status;
alter table public.fx_fetch_log alter column fetch_date set default (now() at time zone 'utc')::date;
alter table public.fx_fetch_log drop constraint fx_fetch_log_outcome_check;
alter table public.fx_fetch_log drop column inserted;
alter table public.fx_fetch_log drop column updated;
alter table public.fx_fetch_log drop column skipped;
alter table public.fx_fetch_log add column currencies_updated int;
alter table public.fx_fetch_log add constraint fx_fetch_log_status_check check (status in ('success', 'failed', 'skipped'));

delete from public.fx_fetch_log older
using public.fx_fetch_log newer
where older.status = 'success'
  and newer.status = 'success'
  and older.fetch_date = newer.fetch_date
  and (older.fetched_at, older.id) < (newer.fetched_at, newer.id);

drop index public.fx_fetch_log_ran_at_idx;
create index fx_fetch_log_fetched_at_idx on public.fx_fetch_log (fetched_at desc);
create unique index fx_fetch_log_one_success_per_day
  on public.fx_fetch_log (fetch_date) where status = 'success';

create table public.fx_refresh_claims (
  fetch_date date primary key,
  claimed_at timestamptz not null default now()
);

alter table public.fx_refresh_claims enable row level security;
grant select, insert, delete on public.fx_refresh_claims to service_role;

create or replace function public.claim_fx_refresh(refresh_date date)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  claimed boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('fx_refresh')) then
    insert into fx_fetch_log (fetch_date, status)
    values (refresh_date, 'skipped');
    return false;
  end if;

  insert into fx_refresh_claims (fetch_date)
  values (refresh_date)
  on conflict do nothing
  returning true into claimed;

  if coalesce(claimed, false) then
    return true;
  end if;

  insert into fx_fetch_log (fetch_date, status)
  values (refresh_date, 'skipped');
  return false;
end;
$$;

create or replace function public.record_fx_refresh_success(refresh_date date, updated_currencies int)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  recorded boolean;
begin
  insert into fx_fetch_log (fetch_date, status, currencies_updated)
  values (refresh_date, 'success', updated_currencies)
  on conflict (fetch_date) where status = 'success' do nothing
  returning true into recorded;

  return coalesce(recorded, false);
end;
$$;

create or replace function public.record_fx_refresh_failure(refresh_date date, failure_error text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into fx_fetch_log (fetch_date, status, error)
  values (refresh_date, 'failed', failure_error);

  delete from fx_refresh_claims where fetch_date = refresh_date;
end;
$$;

revoke all on function public.claim_fx_refresh(date) from public;
revoke all on function public.record_fx_refresh_success(date, int) from public;
revoke all on function public.record_fx_refresh_failure(date, text) from public;
grant execute on function public.claim_fx_refresh(date) to service_role;
grant execute on function public.record_fx_refresh_success(date, int) to service_role;
grant execute on function public.record_fx_refresh_failure(date, text) to service_role;
