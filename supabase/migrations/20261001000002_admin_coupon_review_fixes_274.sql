-- Issue #274 review follow-ups (PR #303). Forward-only: 20261001000000
-- and 20261001000001 applied, not edited.
--
-- 1. admin_list_coupons gains two columns. `updated_at`: the scope
--    allowlist already promised it, so every list/detail response carried
--    a null that never resolves — the shape and the function agree now.
--    `minor_unit`: the per-currency decimal count from the currencies
--    table, so the admin UI formats amount discounts through formatMoney
--    (minor units / 10^minor_unit) instead of interpolating raw storage
--    units ("500 NIO" for C$5.00). RETURNS TABLE change, so drop +
--    recreate (42P13 otherwise — same precedent as migration
--    20260930000001).
-- 2. admin_create_coupon enforces per_household_limit = 1. The unique
--    (coupon_code, household_id) pair caps every household at one
--    redemption row per coupon, so limits above 1 were silently limit-1
--    while the form, schema, and API all accepted them. The operator
--    surface is now honest about the model (one household holds one
--    subscription to discount); the domain column stays general and the
--    redeem-time limit check stays as the backstop. Same signature, so
--    CREATE OR REPLACE suffices.

drop function if exists public.admin_list_coupons();

create function public.admin_list_coupons()
returns table (
  code                text,
  discount_type       text,
  discount_value      int,
  currency            text,
  minor_unit          smallint,
  valid_from          timestamptz,
  valid_until         timestamptz,
  max_redemptions     int,
  per_household_limit int,
  duration            text,
  active              boolean,
  created_at          timestamptz,
  updated_at          timestamptz,
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
         cur.minor_unit,
         c.valid_from, c.valid_until, c.max_redemptions, c.per_household_limit,
         c.duration, c.active, c.created_at, c.updated_at,
         (select count(*) from public.coupon_redemptions r where r.coupon_code = c.code),
         greatest(
           0,
           c.max_redemptions - (select count(*) from public.coupon_redemptions r where r.coupon_code = c.code)
         )
    from public.coupons c
    left join public.currencies cur on cur.code = c.currency
   order by c.created_at desc;
end;
$$;

revoke execute on function public.admin_list_coupons() from public;
grant execute on function public.admin_list_coupons() to authenticated;

comment on function public.admin_list_coupons() is
  'Issue #274 (PR #303 review): coupon list with redemption counts, remaining capacity, updated_at, and per-currency minor_unit for display formatting. Counts only; is_admin() first, 42501 otherwise.';

-- per-household limit is 1 by design (unique redemption pair); reject
-- anything else at the operator surface with its own reason.
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
  -- PR #303 review: the unique (coupon, household) pair caps every
  -- household at one redemption row, so limits above 1 promised what the
  -- storage cannot deliver. Enforced here, at the operator surface.
  if p_per_household_limit != 1 then
    raise exception 'per-household limit is 1 by design (one redemption per household per coupon)' using errcode = '23514';
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
  'Issue #274 (PR #303 review): per-household limit is 1 by design. Otherwise unchanged: every constraint explicit, mandatory reason, in-transaction audit. is_admin() first, 42501 otherwise.';
