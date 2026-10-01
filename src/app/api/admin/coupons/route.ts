// GET/POST /api/admin/coupons — coupon management (#274).
//
// GET: the coupon list with redemption counts and remaining capacity.
// GET ?code=<CODE>: that coupon plus its redemptions (household
// identifiers + timestamps only — never emails or names). The coupon row
// is picked from the list reader, so unknown codes read as neutral 404,
// same as unknown household ids on the households route.
//
// POST: { action: "create" | "set_active", ... }. Creation requires every
// constraint field explicitly (currency is an explicit null for percent —
// present but empty, never omitted); the DB function rejects stillborn
// windows and duplicate codes. set_active flips the flag with a mandatory
// reason; the redeemed-terms trigger underneath allows deactivation only.
// Mutations audit inside the RPC transaction (before/after + reason), so
// the route writes no second audit row for them; the GET reads audit via
// auditAdminAction like the households list/view audits.
//
// Both shapes come from the DEFINER readers via the caller-scoped client
// and are projected through the allowlist in lib/admin/scope.ts as defense
// in depth. Neutral 404 for flag-off/unauthenticated/non-admin (see
// _shared.ts). Double-submit safety: creation is naturally idempotent via
// the code primary key (a redelivered create is a 409, never a second
// row), and set_active reports `idempotent` on same-value calls.

import {
  adminJson,
  adminNotFound,
  auditAdminAction,
  requireAdmin,
  ADMIN_NO_STORE_HEADERS,
  type AdminContext,
} from "../_shared";
import {
  projectAdminKeys,
  ADMIN_COUPON_KEYS,
  ADMIN_COUPON_REDEMPTION_KEYS,
} from "@/lib/admin/scope";
import { z } from "zod";

export const revalidate = 1;

const createBodySchema = z.object({
  action: z.literal("create"),
  code: z.string().trim().min(1).max(32),
  discount_type: z.enum(["percent", "amount"]),
  discount_value: z.number().int(),
  // Required key, nullable value: percent carries no currency and the
  // server rejects a missing key the same as a wrong one — no silent
  // defaults either side.
  currency: z.string().trim().min(1).max(8).nullable(),
  valid_from: z.string().trim().min(1).max(64),
  valid_until: z.string().trim().min(1).max(64),
  max_redemptions: z.number().int(),
  per_household_limit: z.number().int(),
  duration: z.enum(["first_period", "lifetime"]),
  reason: z.string().trim().min(3).max(2000),
});

const setActiveBodySchema = z.object({
  action: z.literal("set_active"),
  code: z.string().trim().min(1).max(32),
  active: z.boolean(),
  reason: z.string().trim().min(3).max(2000),
});

const postBodySchema = z.union([createBodySchema, setActiveBodySchema]);

type CouponRow = Record<string, unknown> & { code?: unknown };

function findCoupon(rows: CouponRow[], code: string): CouponRow | undefined {
  const want = code.trim().toUpperCase();
  return rows.find((r) => String(r.code ?? "").toUpperCase() === want);
}

function couponErrorStatus(message: string, code?: string): number {
  // Same discipline as the households POST: SQLSTATE first. 42501 stays
  // neutral; validation is 400; a duplicate code is 409, never a second
  // row (the redelivered-create answer to double-clicks). Unknown codes
  // read as neutral 404 like unknown households/ids elsewhere — the
  // function reports them as 23514, so they match on message here.
  if (code === "42501") return 404;
  if (code === "23505") return 409;
  if (code === "23514") {
    if (message.includes("unknown coupon")) return 404;
    return 400;
  }
  if (code !== undefined) return 500;
  if (message.includes("already exists")) return 409;
  return 500;
}

export async function GET(request: Request) {
  if (process.env.BUILD_TARGET === "tauri") {
    return Response.json(
      { error: "not found" },
      { status: 404, headers: { ...ADMIN_NO_STORE_HEADERS } },
    );
  }
  const ctx = await requireAdmin(request);
  if (!ctx) return adminNotFound();

  const code = new URL(request.url).searchParams.get("code")?.trim() || null;
  if (code) return getCouponDetail(ctx, code);
  return listCoupons(ctx);
}

async function listCoupons(ctx: AdminContext) {
  const { data, error } = await ctx.db.rpc("admin_list_coupons");
  if (error) throw error;

  const coupons = ((data ?? []) as CouponRow[]).map((row) =>
    projectAdminKeys(row, ADMIN_COUPON_KEYS),
  );

  await auditAdminAction(ctx.db, "coupons.list", null);
  return adminJson({ coupons });
}

async function getCouponDetail(ctx: AdminContext, code: string) {
  const [{ data: list, error: listError }, { data: reds, error: redsError }] = await Promise.all([
    ctx.db.rpc("admin_list_coupons"),
    ctx.db.rpc("admin_get_coupon_redemptions", { p_code: code }),
  ]);
  if (listError) throw listError;
  if (redsError) throw redsError;

  const couponRow = findCoupon((list ?? []) as CouponRow[], code);
  if (!couponRow) return adminNotFound();

  const coupon = projectAdminKeys(couponRow, ADMIN_COUPON_KEYS);
  const redemptions = ((reds ?? []) as Array<Record<string, unknown>>).map((r) =>
    projectAdminKeys(r, ADMIN_COUPON_REDEMPTION_KEYS),
  );

  await auditAdminAction(ctx.db, "coupon.redemptions.view", null);
  return adminJson({ coupon, redemptions });
}

function parseIso(value: string): string | null {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export async function POST(request: Request) {
  if (process.env.BUILD_TARGET === "tauri") {
    return Response.json(
      { error: "not found" },
      { status: 404, headers: { ...ADMIN_NO_STORE_HEADERS } },
    );
  }
  const ctx = await requireAdmin(request);
  if (!ctx) return adminNotFound();

  const parsed = postBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid request body" },
      { status: 400, headers: { ...ADMIN_NO_STORE_HEADERS } },
    );
  }
  const body = parsed.data;

  if (body.action === "create") {
    const validFrom = parseIso(body.valid_from);
    const validUntil = parseIso(body.valid_until);
    if (!validFrom || !validUntil) {
      return Response.json(
        { error: "valid_from and valid_until must be ISO timestamps" },
        { status: 400, headers: { ...ADMIN_NO_STORE_HEADERS } },
      );
    }
    const { error } = await ctx.db.rpc("admin_create_coupon", {
      p_code: body.code,
      p_discount_type: body.discount_type,
      p_discount_value: body.discount_value,
      // Explicit null for percent (required key, empty value — the point of
      // the currency rule). The generated Args type says `string`, but the
      // SQL param is nullable text and PostgREST serializes null fine;
      // hence the narrow cast, not an omission.
      p_currency: body.currency as unknown as string,
      p_valid_from: validFrom,
      p_valid_until: validUntil,
      p_max_redemptions: body.max_redemptions,
      p_per_household_limit: body.per_household_limit,
      p_duration: body.duration,
      p_reason: body.reason,
    });
    if (error) {
      const status = couponErrorStatus(error.message ?? "", (error as { code?: string }).code);
      if (status === 404) return adminNotFound();
      if (status === 500) throw error;
      return Response.json(
        { error: error.message ?? "coupon create failed" },
        { status, headers: { ...ADMIN_NO_STORE_HEADERS } },
      );
    }
    // Re-read through the list reader so the response carries the live
    // counts (0 / max) in the same shape as GET.
    return couponByCode(ctx, body.code, false);
  }

  const { data, error } = await ctx.db.rpc("admin_set_coupon_active", {
    p_code: body.code,
    p_active: body.active,
    p_reason: body.reason,
  });
  if (error) {
    const status = couponErrorStatus(error.message ?? "", (error as { code?: string }).code);
    if (status === 404) return adminNotFound();
    if (status === 500) throw error;
    return Response.json(
      { error: error.message ?? "coupon update failed" },
      { status, headers: { ...ADMIN_NO_STORE_HEADERS } },
    );
  }
  const idempotent = ((data ?? []) as Array<{ was_idempotent?: unknown }>).every(
    (r) => r.was_idempotent === true,
  );
  const res = await couponByCode(ctx, body.code, idempotent);
  return res;
}

/** Re-read one coupon through admin_list_coupons and project it. */
async function couponByCode(ctx: AdminContext, code: string, idempotent: boolean) {
  const { data, error } = await ctx.db.rpc("admin_list_coupons");
  if (error) throw error;
  const couponRow = findCoupon((data ?? []) as CouponRow[], code);
  if (!couponRow) return adminNotFound();
  return adminJson({
    coupon: projectAdminKeys(couponRow, ADMIN_COUPON_KEYS),
    idempotent,
  });
}
