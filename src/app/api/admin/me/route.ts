// GET /api/admin/me — admin session check (#271).
//
// Returns { isAdmin: true } for rostered admins, neutral 404 otherwise
// (flag off, unauthenticated, non-admin all look identical). Audited as
// `me.check` so even session probes leave a row.

import {
  adminJson,
  adminNotFound,
  auditAdminAction,
  requireAdmin,
  ADMIN_NO_STORE_HEADERS,
} from "../_shared";

export const revalidate = 1;

export async function GET() {
  if (process.env.BUILD_TARGET === "tauri") {
    return Response.json(
      { error: "not found" },
      { status: 404, headers: { ...ADMIN_NO_STORE_HEADERS } },
    );
  }
  const ctx = await requireAdmin();
  if (!ctx) return adminNotFound();
  await auditAdminAction(ctx.admin, ctx.userId, "me.check", null);
  return adminJson({ isAdmin: true });
}
