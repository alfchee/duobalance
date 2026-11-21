-- #269 follow-up (PR review): harden the export/deletion surface.
--
-- 1. data_export_links: force the 24h TTL server-side (BEFORE INSERT trigger
--    overwrites any client-supplied created_at/expires_at) and require the
--    token to look like a 256-bit hex secret even when client-supplied.
-- 2. account_deletion_requests: enforce the state machine in a trigger
--    (pending -> confirmed -> purged, either -> cancelled) with bounds that
--    defeat backdating, so direct PostgREST writes cannot skip the typed
--    email confirmation or the 30-day grace enforced by the routes.
--    Clients are additionally barred from writing status='purged' via RLS;
--    only the purge RPC (security definer, service role) may do that.
-- 3. purge_account_deletion() RPC: anonymize + audit + mark-purged in ONE
--    transaction per request (no partial state on retry), and anonymize
--    EVERY membership of the user — including already-removed rows, whose
--    display_name is still PII.

-- ============================================================================
-- 1. data_export_links hardening
-- ============================================================================

alter table public.data_export_links
  add constraint data_export_links_token_hex
  check (token ~ '^[0-9a-f]{64}$');

create or replace function public.force_export_link_ttl()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The 24h window is a security property, not a suggestion: ignore whatever
  -- the caller sent and stamp server time. Token keeps its default (or a
  -- client value that passes the hex check above).
  new.created_at := now();
  new.expires_at := now() + interval '24 hours';
  return new;
end;
$$;

drop trigger if exists tg_force_export_link_ttl on public.data_export_links;

create trigger tg_force_export_link_ttl
  before insert on public.data_export_links
  for each row execute function public.force_export_link_ttl();

comment on function public.force_export_link_ttl() is
  'Stamps server-side created_at/expires_at (24h) on export links so direct writes cannot mint long-lived links.';

-- ============================================================================
-- 2. account_deletion_requests state-machine trigger
-- ============================================================================

create or replace function public.enforce_deletion_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    -- Requests always open as pending with the clock unset; the confirm
    -- route fills it in. This alone defeats pre-dated grace windows.
    if new.status is distinct from 'pending'
       or new.confirmed_at is not null
       or new.scheduled_purge_at is not null
       or new.purged_at is not null then
      raise exception 'deletion requests must open as pending with no timestamps';
    end if;
    return new;
  end if;

  -- UPDATE: only the transitions below are legal.
  if old.status = 'pending' and new.status = 'confirmed' then
    -- confirmed_at must be ~now (10-minute tolerance for clock skew), never
    -- backdated: otherwise a client could start the grace clock in the past
    -- and get purged immediately.
    if new.confirmed_at is null
       or new.confirmed_at < now() - interval '10 minutes'
       or new.confirmed_at > now() + interval '10 minutes' then
      raise exception 'confirmed_at must be approximately now';
    end if;
    if new.scheduled_purge_at is null
       or new.scheduled_purge_at <= new.confirmed_at
       or new.scheduled_purge_at > new.confirmed_at + interval '31 days' then
      raise exception 'scheduled_purge_at must be within 31 days after confirmation';
    end if;
    if new.purged_at is not null then
      raise exception 'purged_at must be null until purged';
    end if;
    return new;
  end if;

  if (old.status = 'pending' or old.status = 'confirmed') and new.status = 'cancelled' then
    return new;
  end if;

  if old.status = 'confirmed' and new.status = 'purged' then
    if new.purged_at is null then
      raise exception 'purged_at must be set when purged';
    end if;
    return new;
  end if;

  raise exception 'illegal deletion status transition: % -> %', old.status, new.status;
end;
$$;

drop trigger if exists tg_enforce_deletion_transition on public.account_deletion_requests;

create trigger tg_enforce_deletion_transition
  before insert or update on public.account_deletion_requests
  for each row execute function public.enforce_deletion_transition();

comment on function public.enforce_deletion_transition() is
  'State machine for account deletion (pending -> confirmed -> purged, either -> cancelled) with anti-backdating bounds. RLS separately bars clients from writing purged.';

-- Clients may move their own rows but never into purged (purge RPC only).
drop policy if exists account_deletion_requests_update_own on public.account_deletion_requests;

create policy account_deletion_requests_update_own
  on public.account_deletion_requests for update to anon, authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and status <> 'purged');

-- ============================================================================
-- 3. purge_account_deletion() — atomic per-request purge
-- ============================================================================

create or replace function public.purge_account_deletion(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req        public.account_deletion_requests;
  v_membership record;
  v_households uuid[] := '{}';
  v_hh         uuid;
  v_touched    uuid;
begin
  select * into v_req
  from public.account_deletion_requests
  where id = p_request
  for update;

  if not found then
    raise exception 'deletion request not found';
  end if;

  if v_req.status is distinct from 'confirmed' then
    raise exception 'only confirmed requests can be purged (status: %)', v_req.status;
  end if;

  if v_req.scheduled_purge_at is null or v_req.scheduled_purge_at > now() then
    raise exception 'grace period has not elapsed';
  end if;

  -- Anonymize EVERY membership of this user, including already-removed rows:
  -- a departed member's display_name is still personal data. Active rows are
  -- additionally soft-removed; already-removed rows keep their original
  -- removed_at/removal_reason. Transactions keep pointing at the same ids,
  -- so the household's books still balance (see docs/data-export-deletion.md).
  for v_membership in
    select id, household_id, removed_at
    from public.household_members
    where user_id = v_req.user_id
  loop
    if v_membership.removed_at is null then
      update public.household_members
        set display_name = 'Deleted member',
            removed_at = now(),
            removal_reason = 'left'
        where id = v_membership.id;
    else
      update public.household_members
        set display_name = 'Deleted member'
        where id = v_membership.id;
    end if;

    if not (v_membership.household_id = any (v_households)) then
      v_households := v_households || v_membership.household_id;
    end if;
  end loop;

  -- One audit row per affected household: ids only, never PII.
  foreach v_hh in array v_households loop
    select id into v_touched
    from public.household_members
    where user_id = v_req.user_id and household_id = v_hh
    limit 1;

    insert into public.deletion_audit_log (household_id, event_type, target_member_id)
    values (v_hh, 'account_deletion_purged', v_touched);
  end loop;

  update public.account_deletion_requests
    set status = 'purged', purged_at = now()
    where id = p_request;

  return jsonb_build_object(
    'user_id', v_req.user_id,
    'households', coalesce(
      (select jsonb_agg(h::text) from unnest(v_households) h),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.purge_account_deletion(uuid) from public;
grant execute on function public.purge_account_deletion(uuid) to authenticated, service_role;

comment on function public.purge_account_deletion(uuid) is
  'Atomically purges one confirmed, past-grace deletion request: anonymize all memberships (incl. already-removed), audit per household (ids only), mark purged. Called by the purge-accounts cron on the service role.';
