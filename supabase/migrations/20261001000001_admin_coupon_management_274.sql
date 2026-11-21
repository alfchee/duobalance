-- Issue #274: admin coupon management (epic #255 Phase A). Forward-only.
--
-- The operational surface for codes that leave the building: every
-- constraint is visible and mandatory at creation (no silent defaults —
-- all admin_create_coupon params are required and the function rejects
-- stillborn windows), and once a coupon has been redeemed its terms are a
-- promise someone already accepted, so deactivation is the only remaining
-- lever.
--
-- Pieces:
--
-- 1. tg_lock_redeemed_coupon(): BEFORE UPDATE on coupons. When a
--    redemption row exists for the coupon, the ONLY permitted change is
--    active true -> false. Value, limits, window, duration, even
--    reactivation (false -> true would re-open redemption on promised
--    terms) are rejected with 23514. Unredeemed coupons stay fully
--    editable. There is deliberately NO admin edit RPC for terms — the
--    trigger is the enforcement, and its absence from the API is the
--    policy. (Revoked-from-public/granted-to-authenticated like the other
--    trigger guard, so the check fires for every writer role.)
-- 2. admin_create_coupon(): every constraint field required in the
--    signature (currency is an explicit null for percent — present but
--    empty, never omitted). Codes canonicalize to upper(trim()) and must
--    match ^[A-Z0-9][A-Z0-9_-]{3,31}$; percent is 1-100 with no currency;
--    amount is >0 with an existing currency; the window must be ordered
--    and end in the future; per_household_limit sits inside
--    1..max_redemptions. Duplicate codes raise 23505 via
--    ON CONFLICT DO NOTHING + explicit re-raise (race-safe, distinct
--    message). Reason mandatory (3-2000, same discipline as #273);
--    before null / after row jsonb audit in-transaction.
-- 3. admin_list_coupons(): every coupon with redemption_count and
--    remaining_capacity (greatest(0, max - count)) — the "can we still
--    hand this out" answer in one screen.
-- 4. admin_set_coupon_active(): reason mandatory; same-value is an
--    audited idempotent no-op; the trigger enforces redeemed-only-
--    deactivation underneath. before/after audit in-transaction.
-- 5. admin_get_coupon_redemptions(): (coupon_code, household_id,
--    redeemed_at) ordered by redemption time — identifiers only, never
--    emails or names. Unknown codes return zero rows (neutral).
--
-- Redemption visibility stays at the identifier level throughout, per the
-- admin data boundary (billing state yes, personal/financial detail no).

-- 1. Immutability guard: redeemed terms are a promise.
create or replace function public.tg_lock_redeemed_coupon()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.coupon_redemptions r where r.coupon_code = OLD.code
  ) then
    return NEW;
  end if;
  if NEW.code is distinct from OLD.code
     or NEW.discount_type is distinct from OLD.discount_type
     or NEW.discount_value is distinct from OLD.discount_value
     or NEW.currency is distinct from OLD.currency
     or NEW.valid_from is distinct from OLD.valid_from
     or NEW.valid_until is distinct from OLD.valid_until
     or NEW.max_redemptions is distinct from OLD.max_redemptions
     or NEW.per_household_limit is distinct from OLD.per_household_limit
     or NEW.duration is distinct from OLD.duration
     or not (OLD.active is true and NEW.active is false) then
    raise exception 'redeemed coupon terms are locked; deactivation is the only change'
      using errcode = '23514';
  end if;
  return NEW;
end;
$$;

drop trigger if exists coupons_lock_redeemed_terms on public.coupons;
create trigger coupons_lock_redeemed_terms
  before update on public.coupons
  for each row execute function public.tg_lock_redeemed_coupon();

revoke execute on function public.tg_lock_redeemed_coupon() from public;
grant execute on function public.tg_lock_redeemed_coupon() to authenticated;

comment on function public.tg_lock_redeemed_coupon() is
  'Issue #274: once redeemed, only active true -> false may change (value/limits/window/reactivation rejected). Unredeemed coupons stay editable.';

-- Shared coupon-row shape for the admin RPC returns.
-- (RETURNS TABLE is per-function; the column list is repeated verbatim so
-- each function stays self-describing in \df.)

-- 2. Create with every constraint explicit.
create or replace function public.admin_create_coupon(
  p_code text,
  p_discount_type text,
  p_discount_value int,
  p_currency text,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_max_redemptions int,
  p_per_household_limit int,
  p_duration text,
  p_reason text
)
returns table (
  code                text,
  discount_type       text,
  discount_value      int,
  currency            text,
  valid_from          timestamptz,
  valid_until         timestamptz,
  max_redemptions     int,
  per_household_limit int,
  duration            text,
  active              boolean,
  created_at          timestamptz,
  updated_at          timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row public.coupons%rowtype;
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{3,31}$' then
    raise exception 'coupon code must be 4-32 chars: A-Z, 0-9, _ or -' using errcode = '23514';
  end if;
  if p_discount_type not in ('percent', 'amount') then
    raise exception 'discount type must be percent or amount' using errcode = '23514';
  end if;
  if p_discount_type = 'percent' then
    if p_discount_value is null or p_discount_value < 1 or p_discount_value > 100 then
      raise exception 'percent discount must be 1-100' using errcode = '23514';
    end if;
    if p_currency is not null then
      raise exception 'percent coupons carry no currency' using errcode = '23514';
    end if;
  else
    if p_discount_value is null or p_discount_value < 1 then
      raise exception 'amount discount must be at least 1 minor unit' using errcode = '23514';
    end if;
    if p_currency is null or btrim(p_currency) = '' then
      raise exception 'amount coupons require a currency' using errcode = '23514';
    end if;
    if not exists (select 1 from public.currencies c where c.code = upper(btrim(p_currency))) then
      raise exception 'unknown currency "%"', p_currency using errcode = '23514';
    end if;
  end if;
  if p_valid_from is null or p_valid_until is null or p_valid_from >= p_valid_until then
    raise exception 'validity window must be ordered (valid_from < valid_until)' using errcode = '23514';
  end if;
  if p_valid_until <= now() then
    raise exception 'validity window must end in the future' using errcode = '23514';
  end if;
  if p_max_redemptions is null or p_max_redemptions < 1 then
    raise exception 'max redemptions must be at least 1' using errcode = '23514';
  end if;
  if p_per_household_limit is null
     or p_per_household_limit < 1
     or p_per_household_limit > p_max_redemptions then
    raise exception 'per-household limit must sit inside 1..max_redemptions' using errcode = '23514';
  end if;
  if p_duration not in ('first_period', 'lifetime') then
    raise exception 'duration must be first_period or lifetime' using errcode = '23514';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 2000 then
    raise exception 'admin coupon reason is required (3-2000 chars)' using errcode = '23514';
  end if;

  insert into public.coupons
    (code, discount_type, discount_value, currency,
     valid_from, valid_until, max_redemptions, per_household_limit, duration)
  values
    (v_code, p_discount_type, p_discount_value,
     case when p_currency is null then null else upper(btrim(p_currency)) end,
     p_valid_from, p_valid_until, p_max_redemptions, p_per_household_limit, p_duration)
  on conflict (code) do nothing
  returning * into v_row;
  if v_row.code is null then
    raise exception 'coupon code "%" already exists', v_code using errcode = '23505';
  end if;

  insert into public.admin_audit_log (actor, action, target_household, reason, before_state, after_state)
  values (auth.uid(), 'coupon.create', null, v_reason, null, to_jsonb(v_row));

  return query
  select v_row.code, v_row.discount_type, v_row.discount_value, v_row.currency,
         v_row.valid_from, v_row.valid_until, v_row.max_redemptions, v_row.per_household_limit,
         v_row.duration, v_row.active, v_row.created_at, v_row.updated_at;
end;
$$;

revoke execute on function public.admin_create_coupon(text, text, int, text, timestamptz, timestamptz, int, int, text, text) from public;
grant execute on function public.admin_create_coupon(text, text, int, text, timestamptz, timestamptz, int, int, text, text) to authenticated;

comment on function public.admin_create_coupon(text, text, int, text, timestamptz, timestamptz, int, int, text, text) is
  'Issue #274: create a coupon with every constraint explicit (no silent defaults). Mandatory reason, in-transaction audit. is_admin() first, 42501 otherwise.';

-- 3. List with live counts.
create or replace function public.admin_list_coupons()
returns table (
  code                text,
  discount_type       text,
  discount_value      int,
  currency            text,
  valid_from          timestamptz,
  valid_until         timestamptz,
  max_redemptions     int,
  per_household_limit int,
  duration            text,
  active              boolean,
  created_at          timestamptz,
  redemption_count    bigint,
  remaining_capacity  bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  return query
  select c.code, c.discount_type, c.discount_value, c.currency,
         c.valid_from, c.valid_until, c.max_redemptions, c.per_household_limit,
         c.duration, c.active, c.created_at,
         (select count(*) from public.coupon_redemptions r where r.coupon_code = c.code),
         greatest(
           0,
           c.max_redemptions - (select count(*) from public.coupon_redemptions r where r.coupon_code = c.code)
         )
    from public.coupons c
   order by c.created_at desc;
end;
$$;

revoke execute on function public.admin_list_coupons() from public;
grant execute on function public.admin_list_coupons() to authenticated;

comment on function public.admin_list_coupons() is
  'Issue #274: coupon list with redemption counts and remaining capacity. Counts only; is_admin() first, 42501 otherwise.';

-- 4. Activate/deactivate (the only lever on redeemed coupons).
create or replace function public.admin_set_coupon_active(
  p_code text,
  p_active boolean,
  p_reason text
)
returns table (
  code                text,
  discount_type       text,
  discount_value      int,
  currency            text,
  valid_from          timestamptz,
  valid_until         timestamptz,
  max_redemptions     int,
  per_household_limit int,
  duration            text,
  active              boolean,
  created_at          timestamptz,
  updated_at          timestamptz,
  was_idempotent      boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before jsonb;
  v_row public.coupons%rowtype;
  v_idem boolean := false;
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 2000 then
    raise exception 'admin coupon reason is required (3-2000 chars)' using errcode = '23514';
  end if;
  if p_active is null then
    raise exception 'active flag is required' using errcode = '23514';
  end if;

  select c.* into v_row from public.coupons c where c.code = v_code limit 1 for update;
  if v_row.code is null then
    raise exception 'unknown coupon "%"', v_code using errcode = '23514';
  end if;
  v_before := to_jsonb(v_row);

  if v_row.active is not distinct from p_active then
    -- Audited idempotent no-op (double-click safe).
    v_idem := true;
  else
    -- The redeemed-terms trigger fires here: reactivating a redeemed
    -- coupon, or any concurrent terms change, is rejected underneath.
    update public.coupons set active = p_active where code = v_code returning * into v_row;
  end if;

  insert into public.admin_audit_log (actor, action, target_household, reason, before_state, after_state)
  values (auth.uid(), 'coupon.set_active', null, v_reason, v_before, to_jsonb(v_row));

  return query
  select v_row.code, v_row.discount_type, v_row.discount_value, v_row.currency,
         v_row.valid_from, v_row.valid_until, v_row.max_redemptions, v_row.per_household_limit,
         v_row.duration, v_row.active, v_row.created_at, v_row.updated_at, v_idem;
end;
$$;

revoke execute on function public.admin_set_coupon_active(text, boolean, text) from public;
grant execute on function public.admin_set_coupon_active(text, boolean, text) to authenticated;

comment on function public.admin_set_coupon_active(text, boolean, text) is
  'Issue #274: coupon activate/deactivate with mandatory reason and before/after audit. Redeemed-terms trigger enforces deactivation-only underneath. is_admin() first, 42501 otherwise.';

-- 5. Redemptions by identifier only.
create or replace function public.admin_get_coupon_redemptions(p_code text)
returns table (
  coupon_code  text,
  household_id uuid,
  redeemed_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  return query
  select r.coupon_code, r.household_id, r.redeemed_at
    from public.coupon_redemptions r
   where r.coupon_code = v_code
   order by r.redeemed_at asc;
end;
$$;

revoke execute on function public.admin_get_coupon_redemptions(text) from public;
grant execute on function public.admin_get_coupon_redemptions(text) to authenticated;

comment on function public.admin_get_coupon_redemptions(text) is
  'Issue #274: which households redeemed a coupon — household ids and timestamps only, never emails or names. is_admin() first, 42501 otherwise.';
