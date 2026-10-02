-- #269 follow-up 2 (Copilot PR review on #299): close the direct-PostgREST
-- bypasses and handle purge-time ownership.
--
-- 1. Route-only writes (invite-flow precedent: household_invites exposes
--    SELECT to clients; creation/deletion is route/RPC-owned):
--    - data_export_links: drop the client INSERT policy + grant. Minting
--      happens in POST /api/exports (service role) after the membership
--      AND plan checks, which RLS alone cannot express (has_feature is
--      fail-closed while the billing flag needs fail-open).
--    - account_deletion_requests: drop client INSERT/UPDATE policies +
--      grants. All transitions run in the account routes (service role,
--      explicitly scoped to auth.uid()). SELECT-own stays for status reads.
--    The state-machine trigger from ...001 remains as defense in depth.
-- 2. Grace floor: scheduled_purge_at must ALSO be >= confirmed_at + 29 days,
--    so a direct writer that somehow reaches the table cannot shrink the
--    30-day grace to seconds (ceiling was already 31 days).
-- 3. purge_account_deletion(): ownership-aware. Per household with an active
--    membership of the purged user —
--    - sole active member  -> soft-delete the household (leave_household's
--      last-member rule) instead of orphaning it;
--    - only active owner  -> promote the earliest-joined other active member,
--      reassign their bills to them, make their shared accounts joint;
--    - otherwise         -> anonymize + soft-remove as before.
--    Already-soft-deleted households are anonymized only (no ownership moves).

-- ============================================================================
-- 1. Route-only writes
-- ============================================================================

drop policy if exists data_export_links_insert_member on public.data_export_links;
revoke insert on public.data_export_links from anon, authenticated;
-- SELECT stays: members can list their household's links.

drop policy if exists account_deletion_requests_insert_own on public.account_deletion_requests;
drop policy if exists account_deletion_requests_update_own on public.account_deletion_requests;
revoke insert, update on public.account_deletion_requests from anon, authenticated;
-- SELECT-own stays: the status route reads through RLS.

-- ============================================================================
-- 2. Grace floor (29-day minimum alongside the 31-day ceiling)
-- ============================================================================

create or replace function public.enforce_deletion_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if new.status is distinct from 'pending'
       or new.confirmed_at is not null
       or new.scheduled_purge_at is not null
       or new.purged_at is not null then
      raise exception 'deletion requests must open as pending with no timestamps';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'confirmed' then
    if new.confirmed_at is null
       or new.confirmed_at < now() - interval '10 minutes'
       or new.confirmed_at > now() + interval '10 minutes' then
      raise exception 'confirmed_at must be approximately now';
    end if;
    if new.scheduled_purge_at is null
       or new.scheduled_purge_at <= new.confirmed_at
       or new.scheduled_purge_at < new.confirmed_at + interval '29 days'
       or new.scheduled_purge_at > new.confirmed_at + interval '31 days' then
      raise exception 'scheduled_purge_at must be 29-31 days after confirmation';
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

-- ============================================================================
-- 3. Ownership-aware purge RPC (replaces the ...001 version)
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
  v_hh         uuid;
  v_touched    uuid;
  v_households uuid[] := '{}';
  v_active     int;
  v_is_owner   boolean;
  v_other      uuid;
  v_hh_deleted boolean;
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

  -- Ownership handling per household with an ACTIVE membership of this user.
  for v_hh in
    select distinct household_id
    from public.household_members
    where user_id = v_req.user_id and removed_at is null
  loop
    select deleted_at is not null into v_hh_deleted
    from public.households where id = v_hh;

    if not coalesce(v_hh_deleted, true) then
      select count(*)::int into v_active
      from public.active_membership
      where household_id = v_hh;

      if v_active <= 1 then
        -- Sole active member: close the household (leave_household's
        -- last-member rule) instead of orphaning it.
        update public.households set deleted_at = now() where id = v_hh;
        insert into public.deletion_audit_log (household_id, event_type, actor_member_id)
        values (v_hh, 'household_deleted', (
          select id from public.household_members
          where user_id = v_req.user_id and household_id = v_hh and removed_at is null
          limit 1));
      else
        -- Only active owner? Promote the earliest-joined other member first
        -- (check_household_has_owner would reject the removal otherwise).
        select exists (
          select 1 from public.active_membership
          where household_id = v_hh and user_id = v_req.user_id and role = 'owner'
        ) into v_is_owner;

        select id into v_other
        from public.active_membership
        where household_id = v_hh and user_id is distinct from v_req.user_id
        order by joined_at asc
        limit 1;

        if v_is_owner and not exists (
          select 1 from public.active_membership
          where household_id = v_hh and role = 'owner'
            and user_id is distinct from v_req.user_id
        ) then
          update public.household_members set role = 'owner' where id = v_other;
        end if;

        -- Bills follow the purged member to the successor; shared accounts
        -- they own become joint (owner null) so the household keeps access.
        -- Private accounts stay owned by the anonymized row (invisible to
        -- the rest, exportable by nobody — same as any departure).
        update public.bills
          set responsible_member_id = v_other
          where household_id = v_hh
            and responsible_member_id in (
              select id from public.household_members
              where user_id = v_req.user_id and household_id = v_hh);

        update public.accounts
          set owner_member_id = null
          where household_id = v_hh
            and is_shared = true
            and owner_member_id in (
              select id from public.household_members
              where user_id = v_req.user_id and household_id = v_hh);
      end if;
    end if;

    if not (v_hh = any (v_households)) then
      v_households := v_households || v_hh;
    end if;
  end loop;

  -- Anonymize EVERY membership of this user, including already-removed rows.
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

  -- One purge audit row per affected household: ids only, never PII.
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
