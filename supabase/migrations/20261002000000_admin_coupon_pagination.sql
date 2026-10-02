-- Admin coupon pagination (code-review follow-up on #274, PR #303).
-- Forward-only: 20261001000000..20261001000004 applied, not edited.
--
-- admin_list_coupons() buffered every coupon with live counts on each call,
-- and couponByCode() re-read the whole list after every POST. At scale one
-- detail view transfers all rows twice. This migration:
-- 1. admin_list_coupons(p_limit, p_offset): LIMIT/OFFSET paging, limit
--    clamped to 1..500 (default 100), offset floored at 0. Same columns and
--    ordering (created_at desc). RETURNS TABLE change, so drop + recreate
--    (42P13 otherwise — same precedent as 20261001000002).
-- 2. admin_get_coupon(p_code): single-coupon reader with the same columns
--    (WHERE upper(code) = v_code, LIMIT 1). Unknown codes return zero rows
--    and the route maps that to the neutral 404 — no full-list transfer.
-- 3. admin_get_coupon_redemptions(p_code, p_limit, p_offset): same rows,
--    paged (default 100, clamp 1..1000). Signature change, so drop +
--    recreate; one-arg calls keep working through the defaults.

drop function if exists public.admin_list_coupons();
drop function if exists public.admin_get_coupon_redemptions(text);

create function public.admin_list_coupons(p_limit int default 100, p_offset int default 0)
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
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
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
   order by c.created_at desc
   limit v_limit offset v_offset;
end;
$$;

revoke execute on function public.admin_list_coupons(int, int) from public;
grant execute on function public.admin_list_coupons(int, int) to authenticated;

comment on function public.admin_list_coupons(int, int) is
  'Admin coupon list with redemption counts, remaining capacity, and per-currency minor_unit. Paged (limit 1..500 default 100, offset >= 0 default 0), created_at desc. is_admin() first, 42501 otherwise.';

create function public.admin_get_coupon(p_code text)
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
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
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
   where c.code = v_code
   limit 1;
end;
$$;

revoke execute on function public.admin_get_coupon(text) from public;
grant execute on function public.admin_get_coupon(text) to authenticated;

comment on function public.admin_get_coupon(text) is
  'Admin single-coupon reader: one row by code for detail/re-read paths, so callers never buffer the full list. Unknown codes return zero rows (route maps to neutral 404). is_admin() first, 42501 otherwise.';

create function public.admin_get_coupon_redemptions(p_code text, p_limit int default 100, p_offset int default 0)
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
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_admin() then
    raise exception 'admin access denied' using errcode = '42501';
  end if;
  return query
  select r.coupon_code, r.household_id, r.redeemed_at
    from public.coupon_redemptions r
   where r.coupon_code = v_code
   order by r.redeemed_at asc
   limit v_limit offset v_offset;
end;
$$;

revoke execute on function public.admin_get_coupon_redemptions(text, int, int) from public;
grant execute on function public.admin_get_coupon_redemptions(text, int, int) to authenticated;

comment on function public.admin_get_coupon_redemptions(text, int, int) is
  'Admin coupon redemptions paged (limit 1..1000 default 100, offset >= 0 default 0), redeemed_at asc. Household ids and timestamps only, never emails or names. is_admin() first, 42501 otherwise.';
