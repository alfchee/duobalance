// GET /api/admin/me — admin session check (#271).
//
// Returns { isAdmin: true } for rostered admins, neutral 404 otherwise
// (flag off, wrong deployment target, unauthenticated, non-admin all look
// identical). Audited as `me.check` so even session probes leave a row.

import {
  adminJson,
  adminNotFound,
  auditAdminAction,
  requireAdmin,
  ADMIN_NO_STORE_HEADERS,
} from "../_shared";

export const revalidate = 1;

export async function GET(request: Request) {
  if (process.env.BUILD_TARGET === "tauri") {
    return Response.json(
      { error: "not found" },
      { status: 404, headers: { ...ADMIN_NO_STORE_HEADERS } },
    );
  }
  const ctx = await requireAdmin(request);
  if (!ctx) return adminNotFound();
  await auditAdminAction(ctx.db, "me.check", null);
  return adminJson({ isAdmin: true });
}
