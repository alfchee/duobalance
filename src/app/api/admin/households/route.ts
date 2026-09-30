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
import { z } from "zod";

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

// POST /api/admin/households — plan overrides and comp grants (#273).
//
// Body: { household_id, action, plan_code?, extend_to?, reason,
//         confirm?, idempotency_key? }. The mutation itself runs inside the
// admin_override_subscription() DEFINER function on the caller-scoped
// client: mandatory reason, before/after audit, confirm-to-revoke,
// one-live respect, and idempotency-key replay are all enforced at the
// database boundary (see migration 20260930000004). The audit INSERT lives
// in that function/transaction, so a failed audit fails the override —
// the route writes no second audit row for the mutation (the GET readers'
// list/view audits above are untouched).
//
// The response re-reads the household detail (summary + full subscription
// history + billing-event metadata) through the same allowlisted readers
// as GET ?id=, plus `idempotent: true` when the call changed nothing
// (key replay, same-state no-op, or revoke with no live row) — the
// operator sees the resulting state without a second round-trip.
const OVERRIDE_ACTIONS = [
  "grant_comped",
  "revoke",
  "extend_trial",
  "extend_grace",
  "change_plan",
] as const;

const overrideBodySchema = z.object({
  // Lenient UUID shape (same UUID_RE as GET ?id=): the fixtures and the
  // existing validators accept any hex grouping, and Postgres re-validates
  // on the RPC cast. Zod's strict uuid() would reject those shapes.
  household_id: z.string().regex(UUID_RE, "invalid household id"),
  action: z.enum(OVERRIDE_ACTIONS),
  plan_code: z.string().trim().min(1).max(64).optional(),
  extend_to: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().min(3).max(2000),
  confirm: z.boolean().optional().default(false),
  idempotency_key: z.string().trim().min(1).max(80).optional(),
});

type OverrideRow = {
  subscription_id: string | null;
  plan_code: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
  updated_at: string | null;
  was_idempotent: boolean | null;
};

function overrideErrorStatus(message: string, code?: string): number {
  if (code === "42501") return 404; // is_admin() race: stay neutral, like requireAdmin
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
  return 500;
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

  const parsed = overrideBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid request body" },
      { status: 400, headers: { ...ADMIN_NO_STORE_HEADERS } },
    );
  }
  const body = parsed.data;

  let extendTo: string | undefined;
  if (body.extend_to !== undefined) {
    const at = new Date(body.extend_to);
    if (Number.isNaN(at.getTime())) {
      return Response.json(
        { error: "extend_to must be an ISO timestamp" },
        { status: 400, headers: { ...ADMIN_NO_STORE_HEADERS } },
      );
    }
    extendTo = at.toISOString();
  }

  const { data, error } = await ctx.db.rpc("admin_override_subscription", {
    p_household: body.household_id,
    p_action: body.action,
    p_plan_code: body.plan_code ?? undefined,
    p_extend_to: extendTo ?? undefined,
    p_reason: body.reason,
    p_confirm: body.confirm,
    p_idempotency_key: body.idempotency_key ?? undefined,
  });
  if (error) {
    const status = overrideErrorStatus(error.message ?? "", (error as { code?: string }).code);
    if (status === 404) return adminNotFound();
    if (status === 500) throw error;
    return Response.json(
      { error: error.message ?? "override failed" },
      { status, headers: { ...ADMIN_NO_STORE_HEADERS } },
    );
  }

  const outRows = (data ?? []) as OverrideRow[];
  // Zero rows = revoke no-op (no live row on either side): nothing changed.
  const idempotent = outRows.length === 0 || outRows.every((r) => r.was_idempotent === true);

  // Re-read the resulting state through the detail readers so the operator
  // sees what the override did without a second round-trip. A revoke no-op
  // (zero override rows) still returns the current detail + idempotent.
  const [{ data: summary, error: summaryError }, { data: subs, error: subsError }] =
    await Promise.all([
      ctx.db.rpc("admin_get_household", { p_household: body.household_id }),
      ctx.db.rpc("admin_get_subscription_history", { p_household: body.household_id }),
    ]);
  if (summaryError) throw summaryError;
  if (subsError) throw subsError;

  const householdRow = (summary ?? [])[0] as Record<string, unknown> | undefined;
  if (!householdRow) return adminNotFound();

  const { data: events, error: eventsError } = await ctx.db.rpc("admin_get_billing_events", {
    p_household: body.household_id,
  });
  if (eventsError) throw eventsError;

  return adminJson({
    household: projectAdminKeys(householdRow, ADMIN_HOUSEHOLD_KEYS),
    subscriptions: ((subs ?? []) as Array<Record<string, unknown>>).map((s) =>
      projectAdminKeys(s, ADMIN_SUBSCRIPTION_KEYS),
    ),
    billingEvents: ((events ?? []) as Array<Record<string, unknown>>).map((e) =>
      projectAdminKeys(e, ADMIN_BILLING_EVENT_KEYS),
    ),
    idempotent,
  });
}
