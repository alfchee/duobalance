// Shared admin route helpers (#271). Server-only — under app/api/**.
// Never import from client code.
//
// Boundary recap (docs/admin-boundary.md):
// - Every admin route returns a NEUTRAL 404 ({ error: "not found" }) when
//   the flag is off, the deployment target does not serve admin, the caller
//   is unauthenticated, or the caller is not an admin. A probe learns
//   nothing: no 401/403 that hints the resource exists, no timing-oracle
//   branch before the flag check.
// - Data AND audit go through the purpose-built DEFINER functions via the
//   caller-scoped client (public key + caller JWT): authorization
//   (is_admin()) and the response shape stay enforced at the database
//   boundary. The service role is never used here — a widened select in
//   TypeScript cannot leak what the database refuses to return.
// - The roster (admin_users) is DISTINCT from household membership — never
//   a household check. The two tables are mutually exclusive per identity
//   (DB triggers, both directions), so an admin JWT can never also be a
//   member JWT.
// - Every successful admin action appends one admin_audit_log row via
//   admin_log_action(), which throws on failure: the action then 500s
//   instead of succeeding unaudited (fail closed — a silent audit gap is
//   worse than a failed support read).
// - Responses carry no-store + hardening headers. There is deliberately NO
//   impersonation helper anywhere in this directory (product decision, not
//   an oversight — see docs/admin-boundary.md).

import { createRouteContext, getAuthedUser } from "@/app/api/_shared";
import { isBillingEnabled } from "@/lib/billing/enabled";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export const ADMIN_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
} as const;

/** Neutral denial: identical body for every denial cause. */
export function adminNotFound() {
  return Response.json(
    { error: "not found" },
    { status: 404, headers: { ...ADMIN_NO_STORE_HEADERS } },
  );
}

export function adminJson(body: unknown) {
  return Response.json(body, { status: 200, headers: { ...ADMIN_NO_STORE_HEADERS } });
}

export type AdminContext = {
  /** Caller-scoped client (public key + caller JWT): RLS + is_admin() apply. */
  db: SupabaseClient<Database>;
  userId: string;
};

function getAppMode(): string {
  return (process.env.APP_MODE ?? "").trim().toLowerCase();
}

/**
 * Per-target denial (#271 review): APP_MODE=user deployments never serve
 * admin; APP_MODE=admin deployments additionally bind to ADMIN_APP_URL so
 * the admin surface answers only on its own domain. Unset (local dev)
 * allows both — the billing flag still gates.
 */
export function adminTargetAllows(request: Request): boolean {
  const mode = getAppMode();
  if (mode === "user") return false;
  if (mode !== "admin") return true;
  const adminOrigin = (process.env.ADMIN_APP_URL ?? "").trim();
  if (!adminOrigin) return true;
  try {
    return new URL(request.url).host.toLowerCase() === new URL(adminOrigin).host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Verify the caller is an admin. Returns null (caller maps to
 * adminNotFound()) when the flag is off, the target does not serve admin,
 * the JWT is missing/invalid, or is_admin() is false for the caller.
 */
export async function requireAdmin(request: Request): Promise<AdminContext | null> {
  // Flag first: while billing is off the admin surface does not exist yet
  // (#262 gating covers admin billing screens too).
  if (!isBillingEnabled()) return null;
  if (!adminTargetAllows(request)) return null;

  const supabase = await createRouteContext();
  let user;
  try {
    user = await getAuthedUser(supabase);
  } catch {
    return null;
  }

  const { createSupabaseUserClient } = await import("@/lib/supabase/server");
  const db = await createSupabaseUserClient();
  const { data: isAdmin, error } = await db.rpc("is_admin");
  if (error || !isAdmin) return null;
  return { db, userId: user.id };
}

/**
 * Append one audit row via admin_log_action() on the caller-scoped client
 * (actor = the caller, enforced by the function). Throws on failure so the
 * action fails instead of succeeding unaudited.
 */
export async function auditAdminAction(
  db: SupabaseClient<Database>,
  action: string,
  targetHousehold: string | null,
  reason?: string,
): Promise<void> {
  const { error } = await db.rpc("admin_log_action", {
    p_action: action,
    p_target_household: targetHousehold ?? undefined,
    p_reason: reason ?? undefined,
    p_before: undefined,
    p_after: undefined,
  });
  if (error) {
    console.error("admin: audit write failed", { action, error });
    throw new Error(`admin audit write failed: ${action}`);
  }
}

/**
 * Shared admin preamble (was copy-pasted into every admin GET/POST):
 * Tauri guard, requireAdmin, neutral 404. Handlers receive the admin
 * context plus the request (for query params / bodies):
 *
 *   export async function GET(request: Request) {
 *     return withAdmin(request, async (ctx, req) => { ... });
 *   }
 */
export async function withAdmin(
  request: Request,
  handler: (ctx: AdminContext, request: Request) => Promise<Response>,
): Promise<Response> {
  if (process.env.BUILD_TARGET === "tauri") return adminNotFound();
  const ctx = await requireAdmin(request);
  if (!ctx) return adminNotFound();
  return handler(ctx, request);
}

/**
 * Shared SQLSTATE → status mapping for the admin mutation routes
 * (was duplicated as couponErrorStatus / overrideErrorStatus).
 * SQLSTATE first: 42501/23503 stay neutral, 23505 is a conflict,
 * validation is 400 — except unknown-coupon 23514, which reads as the
 * neutral 404 like unknown households. The message fallbacks exist for
 * error shapes without a code (PostgREST errors always carry one).
 */
export function mapAdminSqlError(message: string, code?: string): number {
  if (code === "42501" || code === "23503") return 404;
  if (code === "23505") return 409;
  if (code === "23514") {
    if (message.includes("unknown coupon")) return 404;
    return 400;
  }
  if (code !== undefined) return 500;
  if (
    message.includes("reason is required") ||
    message.includes("confirmation") ||
    message.includes("needs a") ||
    message.includes("unknown override action") ||
    message.includes("unknown plan code") ||
    message.includes("no live subscription") ||
    message.includes("invalid input") ||
    message.includes("idempotency key too long")
  ) {
    return 400;
  }
  if (message.includes("already holds a live subscription")) return 409;
  if (message.includes("already exists")) return 409;
  return 500;
}

/** Parse an operator-entered ISO timestamp, null when invalid. */
export function parseIsoDate(value: string): string | null {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
