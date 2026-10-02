// GET /api/admin/me — admin session check (#271).
//
// Returns { isAdmin: true } for rostered admins, neutral 404 otherwise
// (flag off, wrong deployment target, unauthenticated, non-admin all look
// identical). Audited as `me.check` so even session probes leave a row.

import { adminJson, auditAdminAction, withAdmin } from "../_shared";

export const revalidate = 1;

export async function GET(request: Request) {
  return withAdmin(request, async (ctx) => {
    await auditAdminAction(ctx.db, "me.check", null);
    return adminJson({ isAdmin: true });
  });
}
