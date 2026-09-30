// GET /api/admin/households — household list + household detail (#271, #272).
//
// List: ?search=&status=&limit=&offset=. Detail: ?id=<uuid> returns
// { household, subscriptions, billingEvents } — the count summary plus the
// FULL subscription history (every subscription row incl. expired, each
// with its timestamps — the "why did access change" answer) and
// billing-event metadata (type + timestamps + subscription link, never the
// payload). Comped households are flagged via is_comped so support cannot
// mistake them for paying ones.
//
// #272 additions: last_activity on every household row (latest
// user-driven timestamp — the list and detail headers agree on it),
// member-email search (p_search matches auth.users email server-side but
// the address is never returned — "email" stays forbidden), and extended
// status filters: comped (live comped row), none (no live subscription),
// expired (no live row but an expired subscription exists), plus the plain
// lifecycle statuses against the live row. `cancelled` is the live-row
// sense (currently cancelled with remaining entitlement — a household
// whose cancellation period already elapsed has no live row and reads as
// `none`, same as an expired one). Unknown statuses match nothing.
//
// Detail lives on this route as ?id= rather than a [id] segment on purpose:
// under `output: "export"` (Tauri) a GET collection route and a GET member
// route collide (file vs directory in out/), and the repo has no GET+GET
// parent/child precedent — POST-only children (webhook, invites) are the
// ones that coexist. A single GET file exports cleanly.
//
// Both shapes come from the DEFINER readers via the caller-scoped client,
// so authorization (is_admin()) and the response shape are enforced at the
// database boundary; rows are additionally projected through the allowlist
// in lib/admin/scope.ts as defense in depth (a future widened function
// output still cannot leak through this route). Neutral 404 for
// flag-off/unauthenticated/non-admin/unknown-id (see _shared.ts). List
// audited as `households.list`, detail as `households.view`.

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
  ADMIN_BILLING_EVENT_KEYS,
  ADMIN_HOUSEHOLD_KEYS,
  ADMIN_SUBSCRIPTION_KEYS,
} from "@/lib/admin/scope";

export const revalidate = 1;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseListParams(url: string) {
  const params = new URL(url).searchParams;
  const rawLimit = Number.parseInt(params.get("limit") ?? "50", 10);
  const rawOffset = Number.parseInt(params.get("offset") ?? "0", 10);
  return {
    search: (params.get("search") ?? "").trim().slice(0, 80) || null,
    status: params.get("status")?.trim() || null,
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50,
    offset: Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0,
  };
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

  const id = new URL(request.url).searchParams.get("id")?.trim() || null;
  if (id) return getHouseholdDetail(ctx, id);
  return listHouseholds(ctx, request.url);
}

async function listHouseholds(ctx: AdminContext, url: string) {
  const { search, status, limit, offset } = parseListParams(url);

  const { data, error } = await ctx.db.rpc("admin_list_households", {
    p_search: search ?? undefined,
    p_status: status ?? undefined,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) =>
    projectAdminKeys(row, ADMIN_HOUSEHOLD_KEYS),
  );

  await auditAdminAction(ctx.db, "households.list", null);
  return adminJson({ households: rows });
}

async function getHouseholdDetail(ctx: AdminContext, id: string) {
  if (!UUID_RE.test(id)) return adminNotFound();

  const [{ data: summary, error: summaryError }, { data: subs, error: subsError }] =
    await Promise.all([
      ctx.db.rpc("admin_get_household", { p_household: id }),
      ctx.db.rpc("admin_get_subscription_history", { p_household: id }),
    ]);
  if (summaryError) throw summaryError;
  if (subsError) throw subsError;

  const householdRow = (summary ?? [])[0] as Record<string, unknown> | undefined;
  if (!householdRow) return adminNotFound();

  const { data: events, error: eventsError } = await ctx.db.rpc("admin_get_billing_events", {
    p_household: id,
  });
  if (eventsError) throw eventsError;

  const household = projectAdminKeys(householdRow, ADMIN_HOUSEHOLD_KEYS);
  const subscriptions = ((subs ?? []) as Array<Record<string, unknown>>).map((s) =>
    projectAdminKeys(s, ADMIN_SUBSCRIPTION_KEYS),
  );
  const billingEvents = ((events ?? []) as Array<Record<string, unknown>>).map((e) =>
    projectAdminKeys(e, ADMIN_BILLING_EVENT_KEYS),
  );

  await auditAdminAction(ctx.db, "households.view", id);
  return adminJson({ household, subscriptions, billingEvents });
}
