-- claim_fx_refresh's stranded-claim takeover (migration 20260814060000) only
-- checked claimed_at against the 1-hour reclaim window — it never checked
-- whether the date had already succeeded. So a retry more than an hour after
-- a successful run (a stray duplicate cron tick, a manual re-trigger) could
-- reclaim the day, re-fetch from the provider, and re-apply rates that were
-- already recorded, silently burning provider quota. Short-circuit on an
-- existing success log entry before ever attempting the claim.
create or replace function public.claim_fx_refresh(refresh_date date)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  claimed boolean;
begin
  if exists (
    select 1 from fx_fetch_log
    where fetch_date = refresh_date and status = 'success'
  ) then
    insert into fx_fetch_log (fetch_date, status)
    values (refresh_date, 'skipped');
    return false;
  end if;

  if not pg_try_advisory_xact_lock(hashtext('fx_refresh:' || refresh_date::text)) then
    insert into fx_fetch_log (fetch_date, status)
    values (refresh_date, 'skipped');
    return false;
  end if;

  insert into fx_refresh_claims (fetch_date, claimed_at)
  values (refresh_date, now())
  on conflict (fetch_date) do update
    set claimed_at = excluded.claimed_at
    where fx_refresh_claims.claimed_at < now() - interval '1 hour'
  returning true into claimed;

  if coalesce(claimed, false) then
    return true;
  end if;

  insert into fx_fetch_log (fetch_date, status)
  values (refresh_date, 'skipped');
  return false;
end;
$$;

revoke all on function public.claim_fx_refresh(date) from public;
grant execute on function public.claim_fx_refresh(date) to service_role;

-- The original migration 20260814060000 comment said a claim row means a run
-- "has committed a success/failure log entry" — but record_fx_refresh_failure
-- always deletes the row, so a failed run never leaves one behind. Correct
-- the comment so it doesn't imply the opposite of what the code does.
comment on table public.fx_refresh_claims is
  'Refreshes are one-per-UTC-day. A row here means a run for this date is either in flight or has committed a success log entry (a failed run deletes its row so the next attempt is not blocked).';
