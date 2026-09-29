// Shared admin route helpers (#271). Server-only — under app/api/**, may
// import the service-role client. Never import from client code.
//
// Boundary recap (docs/admin-boundary.md):
// - Every admin route returns a NEUTRAL 404 ({ error: "not found" }) when
//   the flag is off, the caller is unauthenticated, or the caller is not
//   an admin. A probe learns nothing: no 401/403 that hints the resource
//   exists, no timing-oracle branch before the flag check.
// - The service role bypasses RLS, so authorization is explicit here:
//   verify the JWT, then look the caller up in public.admin_users (a roster
//   DISTINCT from household membership — never a household check).
// - Reads use the service role but project through the allowlist in
//   lib/admin/scope.ts (counts + billing metadata only). The DEFINER
//   functions in the migration enforce the same allowlist for direct
//   PostgREST access; routes mirror it and are pinned by vitest.
// - Every successful admin action appends one admin_audit_log row
//   (actor, action, target, timestamp). Audit failures are logged but never
//   fail the read — a read that fails closed on audit would turn an audit
//   outage into a support outage.
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

/** Neutral denial: identical body for flag-off, unauthenticated, non-admin. */
export function adminNotFound() {
  return Response.json(
    { error: "not found" },
    { status: 404, headers: { ...ADMIN_NO_STORE_HEADERS } },
  );
}

export function adminJson(body: unknown, auditLogged = true) {
  void auditLogged;
  return Response.json(body, { status: 200, headers: { ...ADMIN_NO_STORE_HEADERS } });
}

type AdminContext = {
  supabase: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
  userId: string;
};

/**
 * Verify the caller is an admin. Returns null (caller maps to adminNotFound())
 * when the flag is off, the JWT is missing/invalid, or the roster has no row.
 * The roster lookup runs on the service role scoped to the CALLER id —
 * never a membership check, never an impersonation grant.
 */
export async function requireAdmin(): Promise<AdminContext | null> {
  // Flag first: while billing is off the admin surface does not exist yet
  // (#262 gating covers admin billing screens too).
  if (!isBillingEnabled()) return null;

  const supabase = await createRouteContext();
  let user;
  try {
    user = await getAuthedUser(supabase);
  } catch {
    return null;
  }

  const { createSupabaseServiceRoleClient } = await import("@/lib/supabase/server");
  const admin = createSupabaseServiceRoleClient();
  const { data: roster } = await admin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!roster) return null;
  return { supabase, admin, userId: user.id };
}

/** Best-effort audit: one row per successful admin action. Never throws. */
export async function auditAdminAction(
  admin: SupabaseClient<Database>,
  actor: string,
  action: string,
  targetHousehold: string | null,
  reason?: string,
): Promise<void> {
  try {
    await admin.from("admin_audit_log").insert({
      actor,
      action,
      target_household: targetHousehold,
      reason: reason ?? null,
    });
  } catch (err) {
    console.error("admin: audit write failed", { action, err });
  }
}
