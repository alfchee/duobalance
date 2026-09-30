-- Issue #273 review follow-ups (PR #302, epic #255 Phase A).
-- Forward-only: 20260930000004 applied, not edited. Redefines
-- admin_override_subscription() with three fixes, everything else verbatim:
--
-- 1. change_plan onto comped normalizes the row to active. Clearing the
--    windows while keeping the status violated dunning_needs_grace_end for
--    past_due/grace rows (the override failed outright) and left
--    trialing/cancelled rows in misleading lifecycle states. A perpetual
--    comped row is active, period — same as grant_comped provisions.
-- 2. Idempotency-key replay is serialized per key. The replay lookup was
--    check-then-act: two concurrent requests with the same new key could
--    both miss, and the second then died on admin_audit_log_idempotency_uidx
--    instead of replaying. An advisory xact lock on
--    actor|household|action|key is now taken BEFORE the lookup, so the
--    waiter blocks until the first transaction commits and then sees its
--    audit row (READ COMMITTED). Scope is one key: unrelated overrides and
--    key-less calls never block on each other.
-- 3. Extends cannot shorten a window. extend_trial/extend_grace accepted any
--    future timestamp, so a non-destructive action could shrink entitlement
--    without revoke confirmation. Values before the current window end are
--    now rejected (23514); equality stays valid for idempotent retries.

create or replace function public.admin_override_subscription(
  p_household uuid,
  p_action text,
  p_plan_code text default null,
  p_extend_to timestamptz default null,
  p_reason text default null,
  p_confirm boolean default false,
  p_idempotency_key text default null
)
returns table (
  subscription_id   uuid,
  plan_code         text,
  status            text,
  trial_ends_at     timestamptz,
  current_period_end timestamptz,
  grace_ends_at     timestamptz,
  updated_at        timestamptz,
  was_idempotent    boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_audit_action text;
  v_live public.subscriptions%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result public.subscriptions%rowtype;
  v_replay jsonb;
  v_idem boolean := false;
  v_reason text;
  v_window_end timestamptz;
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;

  if p_action not in ('grant_comped', 'revoke', 'extend_trial', 'extend_grace', 'change_plan') then
    raise exception 'unknown override action "%"', p_action using errcode = '23514';
  end if;
  v_audit_action := 'subscription.' || p_action;

  -- Mandatory reason: the only thing that will explain this change six
  -- months from now. Trimmed, minimum 3 chars (no "." placeholders), max
  -- 2000 (the route enforces the same cap client-side).
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 3 or char_length(v_reason) > 2000 then
    raise exception 'admin override reason is required (3-2000 chars)' using errcode = '23514';
  end if;

  if p_idempotency_key is not null and char_length(p_idempotency_key) > 80 then
    raise exception 'idempotency key too long (max 80 chars)' using errcode = '23514';
  end if;

  -- Double-click replay: same actor + target + action + key returns the
  -- stored outcome with zero state touch. The advisory xact lock serializes
  -- concurrent redeliveries of one key (fix 2): the waiter blocks until the
  -- first transaction commits, then the lookup below sees its audit row.
  -- Key-less calls skip the lock entirely and never block each other.
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(
      auth.uid()::text || '|' || p_household::text || '|' || v_audit_action || '|' || p_idempotency_key
    ));
    select a.after_state into v_replay
      from public.admin_audit_log a
     where a.actor = auth.uid()
       and a.target_household = p_household
       and a.action = v_audit_action
       and a.idempotency_key = p_idempotency_key;
    if found then
      v_idem := true;
      if v_replay is null then
        -- Revoke no-op replay (no live row on either side): zero rows,
        -- same as the original call. The caller refetches the detail view.
        return;
      end if;
      return query
      select (v_replay->>'id')::uuid,
             v_replay->>'plan_code',
             v_replay->>'status',
             (v_replay->>'trial_ends_at')::timestamptz,
             (v_replay->>'current_period_end')::timestamptz,
             (v_replay->>'grace_ends_at')::timestamptz,
             (v_replay->>'updated_at')::timestamptz,
             true;
      return;
    end if;
  end if;

  -- Lock the live row by the one-live INDEX status list (status-only —
  -- see migration 20260930000004 note 1). FOR UPDATE serializes concurrent
  -- overrides and signups racing the operator on the same household.
  select s.* into v_live
    from public.subscriptions s
   where s.household_id = p_household
     and s.status in ('trialing', 'active', 'past_due', 'grace', 'cancelled')
   limit 1
   for update;

  v_before := case when v_live.id is null then null else to_jsonb(v_live) end;

  if p_action = 'grant_comped' then
    if v_live.id is not null then
      if v_live.plan_code = 'comped' and v_live.status = 'active' then
        -- Natural idempotency: already comped, same state back.
        v_result := v_live;
        v_idem := true;
      else
        raise exception 'household already holds a live subscription (%)', v_live.status
          using errcode = '23505';
      end if;
    else
      insert into public.subscriptions (household_id, plan_code, provider, status)
      values (p_household, 'comped', 'admin', 'active')
      on conflict (household_id)
        where status in ('trialing', 'active', 'past_due', 'grace', 'cancelled')
        do nothing
      returning * into v_result;
      if v_result.id is null then
        -- Lost the race: a live row landed between the lock and the
        -- insert (concurrent signup). Re-read; comped-active is still an
        -- idempotent hit, anything else is the one-live violation.
        select s.* into v_live
          from public.subscriptions s
         where s.household_id = p_household
           and s.status in ('trialing', 'active', 'past_due', 'grace', 'cancelled')
         limit 1;
        if v_live.plan_code = 'comped' and v_live.status = 'active' then
          v_result := v_live;
          v_idem := true;
        else
          raise exception 'household already holds a live subscription (%)', v_live.status
            using errcode = '23505';
        end if;
      end if;
    end if;

  elsif p_action = 'revoke' then
    -- Anything that removes entitlement requires an explicit confirmation.
    if coalesce(p_confirm, false) is not true then
      raise exception 'revoking entitlement requires explicit confirmation' using errcode = '23514';
    end if;
    if v_live.id is null then
      -- Natural idempotency: nothing live, nothing to remove. Audit the
      -- no-op (before/after null) and return zero rows.
      insert into public.admin_audit_log (actor, action, target_household, reason, before_state, after_state, idempotency_key)
      values (auth.uid(), v_audit_action, p_household, v_reason, null, null, p_idempotency_key);
      return;
    end if;
    update public.subscriptions
       set status = 'expired',
           current_period_end = null
     where id = v_live.id
     returning * into v_result;

  elsif p_action = 'extend_trial' then
    if p_extend_to is null or p_extend_to <= now() or p_extend_to > now() + interval '5 years' then
      raise exception 'extend_trial needs a future p_extend_to (within 5 years)' using errcode = '23514';
    end if;
    if v_live.id is null then
      raise exception 'no live subscription to extend' using errcode = '23514';
    end if;
    if v_live.status <> 'trialing' then
      raise exception 'extend_trial needs a trialing subscription (found %)', v_live.status
        using errcode = '23514';
    end if;
    -- Fix 3: an extend must not shorten the window. Equality stays valid
    -- for idempotent retries; anything before the current end is rejected
    -- (shrinking entitlement is revoke's job, with confirmation).
    v_window_end := coalesce(v_live.trial_ends_at, v_live.current_period_end);
    if v_window_end is not null and p_extend_to < v_window_end then
      raise exception 'extend_trial needs a p_extend_to on or after the current trial end' using errcode = '23514';
    end if;
    update public.subscriptions
       set trial_ends_at = p_extend_to,
           current_period_end = p_extend_to
     where id = v_live.id
     returning * into v_result;
    if v_result.trial_ends_at = v_live.trial_ends_at
       and v_result.current_period_end = v_live.current_period_end then
      v_idem := true;
    end if;

  elsif p_action = 'extend_grace' then
    if p_extend_to is null or p_extend_to <= now() or p_extend_to > now() + interval '5 years' then
      raise exception 'extend_grace needs a future p_extend_to (within 5 years)' using errcode = '23514';
    end if;
    if v_live.id is null then
      raise exception 'no live subscription to extend' using errcode = '23514';
    end if;
    if v_live.status not in ('past_due', 'grace') then
      raise exception 'extend_grace needs a past_due or grace subscription (found %)', v_live.status
        using errcode = '23514';
    end if;
    -- Fix 3, same as extend_trial: equality replays, earlier shrinks.
    if v_live.grace_ends_at is not null and p_extend_to < v_live.grace_ends_at then
      raise exception 'extend_grace needs a p_extend_to on or after the current grace end' using errcode = '23514';
    end if;
    update public.subscriptions
       set grace_ends_at = p_extend_to
     where id = v_live.id
     returning * into v_result;
    if v_result.grace_ends_at = v_live.grace_ends_at then
      v_idem := true;
    end if;

  elsif p_action = 'change_plan' then
    if p_plan_code is null or btrim(p_plan_code) = '' then
      raise exception 'change_plan needs a p_plan_code' using errcode = '23514';
    end if;
    if not exists (select 1 from public.plans where code = p_plan_code) then
      raise exception 'unknown plan code "%"', p_plan_code using errcode = '23514';
    end if;
    if v_live.id is null then
      -- No live row: provision one. Comped rows are perpetual (no dates
      -- -> infinity); paid rows open a 30-day window so the row is live
      -- but not perpetual.
      if p_plan_code = 'comped' then
        insert into public.subscriptions (household_id, plan_code, provider, status)
        values (p_household, p_plan_code, 'admin', 'active')
        on conflict (household_id)
          where status in ('trialing', 'active', 'past_due', 'grace', 'cancelled')
          do nothing
        returning * into v_result;
      else
        insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end)
        values (p_household, p_plan_code, 'admin', 'active', now() + interval '30 days')
        on conflict (household_id)
          where status in ('trialing', 'active', 'past_due', 'grace', 'cancelled')
          do nothing
        returning * into v_result;
      end if;
      if v_result.id is null then
        raise exception 'household already holds a live subscription' using errcode = '23505';
      end if;
    else
      if v_live.plan_code = p_plan_code then
        -- Natural idempotency: same plan already.
        v_result := v_live;
        v_idem := true;
      elsif p_plan_code = 'comped' then
        -- Fix 1: moving onto comped makes the row perpetual AND active.
        -- Clearing the windows while keeping past_due/grace status would
        -- violate dunning_needs_grace_end, and a perpetual trialing or
        -- cancelled row would mislead the next operator reading the
        -- history. Same shape grant_comped provisions.
        update public.subscriptions
           set plan_code = 'comped',
               status = 'active',
               trial_ends_at = null,
               current_period_end = null,
               grace_ends_at = null,
               cancel_at_period_end = false
         where id = v_live.id
         returning * into v_result;
      elsif v_live.plan_code = 'comped'
         and v_live.current_period_end is null
         and v_live.grace_ends_at is null then
        -- Moving off comped: the row has no windows (infinity). Open a
        -- 30-day window so the household is entitled but not perpetual.
        update public.subscriptions
           set plan_code = p_plan_code,
               current_period_end = now() + interval '30 days',
               cancel_at_period_end = false
         where id = v_live.id
         returning * into v_result;
      else
        update public.subscriptions
           set plan_code = p_plan_code,
               cancel_at_period_end = false
         where id = v_live.id
         returning * into v_result;
      end if;
    end if;
  end if;

  v_after := case when v_result.id is null then null else to_jsonb(v_result) end;

  -- Audit inside the same transaction: a failed audit fails the override.
  insert into public.admin_audit_log (actor, action, target_household, reason, before_state, after_state, idempotency_key)
  values (auth.uid(), v_audit_action, p_household, v_reason, v_before, v_after, p_idempotency_key);

  return query
  select v_result.id,
         v_result.plan_code,
         v_result.status,
         v_result.trial_ends_at,
         v_result.current_period_end,
         v_result.grace_ends_at,
         v_result.updated_at,
         v_idem;
end;
$$;

revoke execute on function public.admin_override_subscription(uuid, text, text, timestamptz, text, boolean, text) from public;
grant execute on function public.admin_override_subscription(uuid, text, text, timestamptz, text, boolean, text) to authenticated;

comment on function public.admin_override_subscription(uuid, text, text, timestamptz, text, boolean, text) is
  'Issue #273 (PR #302 review): comped moves normalize to active; idempotency keys serialize on an advisory xact lock; extends reject window-shortening (equality still idempotent). Mandatory reason, before/after audit, confirm-to-revoke, one-live respected. is_admin() first, 42501 otherwise.';
