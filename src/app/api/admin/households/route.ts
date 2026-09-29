// GET /api/admin/households — household list + household detail (#271).
//
// List: ?search=&status=&limit=&offset=. Detail: ?id=<uuid> returns
// { household, subscriptions, billingEvents } — the count summary plus the
// FULL subscription history (every state transition with timestamps, the
// "why did access change" answer) and billing-event metadata (type +
// timestamps, never the payload). Comped households are flagged via
// is_comped so support cannot mistake them for paying ones.
//
// Detail lives on this route as ?id= rather than a [id] segment on purpose:
// under `output: "export"` (Tauri) a GET collection route and a GET member
// route collide (file vs directory in out/), and the repo has no GET+GET
// parent/child precedent — POST-only children (webhook, invites) are the
// ones that coexist. A single GET file exports cleanly.
//
// Both shapes return ONLY the allowlist in lib/admin/scope.ts: plan,
// subscription status, period ends, comped flag and member/account/
// transaction COUNTS — never transaction contents, account names, or
// categories. Neutral 404 for flag-off/unauthenticated/non-admin/unknown-id
// (see _shared.ts). List audited as `households.list`, detail as
// `households.view`. Live-subscription resolution mirrors household_plan()
// time-liveness (grace_ends_at preferred, dateless comped rows live forever)
// so the list agrees with entitlements.

import {
  adminJson,
  adminNotFound,
  auditAdminAction,
  requireAdmin,
  ADMIN_NO_STORE_HEADERS,
} from "../_shared";
import {
  projectAdminKeys,
  ADMIN_BILLING_EVENT_KEYS,
  ADMIN_HOUSEHOLD_KEYS,
  ADMIN_SUBSCRIPTION_KEYS,
} from "@/lib/admin/scope";

export const revalidate = 1;

const LIVE_STATUSES = new Set(["trialing", "active", "past_due", "grace", "cancelled"]);

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
  const ctx = await requireAdmin();
  if (!ctx) return adminNotFound();

  const id = new URL(request.url).searchParams.get("id")?.trim() || null;
  if (id) return getHouseholdDetail(ctx, id);
  return listHouseholds(ctx, request.url);
}

async function listHouseholds(
  ctx: NonNullable<Awaited<ReturnType<typeof requireAdmin>>>,
  url: string,
) {
  const { search, status, limit, offset } = parseListParams(url);
  if (status !== null && !LIVE_STATUSES.has(status) && status !== "expired") {
    return Response.json(
      { error: "not found" },
      { status: 404, headers: { ...ADMIN_NO_STORE_HEADERS } },
    );
  }

  // Service-role reads, allowlisted before they leave the server. Households
  // first (search + pagination), then per-household billing/counts. At
  // support scale (a few thousand households, page ≤ 200) this is one
  // batched round-trip set; #272 adds a count-cached view if it ever lags.
  let query = ctx.admin
    .from("households")
    .select("id, name, country, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (search) {
    // Identifier or name fragment. Owner-email search (#272) needs an
    // auth.users join the service role must not expose; out of scope here.
    query = query.or(`id.eq.${search},name.ilike.%${search}%`);
  }
  const { data: households, error: householdsError } = await query;
  if (householdsError) throw householdsError;

  const ids = (households ?? []).map((h) => h.id as string);
  const [subs, members, accounts, transactions] = await Promise.all([
    ids.length
      ? ctx.admin
          .from("subscriptions")
          .select("household_id, plan_code, status, current_period_end")
          .in("household_id", ids)
      : Promise.resolve({ data: [] as never[], error: null }),
    ids.length
      ? ctx.admin.from("household_members").select("household_id").in("household_id", ids)
      : Promise.resolve({ data: [] as never[], error: null }),
    ids.length
      ? ctx.admin.from("accounts").select("household_id").in("household_id", ids)
      : Promise.resolve({ data: [] as never[], error: null }),
    ids.length
      ? ctx.admin.from("transactions").select("household_id").in("household_id", ids)
      : Promise.resolve({ data: [] as never[], error: null }),
  ]);
  if (subs.error) throw subs.error;
  if (members.error) throw members.error;
  if (accounts.error) throw accounts.error;
  if (transactions.error) throw transactions.error;

  const countBy = (rows: Array<{ household_id: string }>) => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.household_id, (map.get(row.household_id) ?? 0) + 1);
    return map;
  };
  const memberCounts = countBy((members.data ?? []) as Array<{ household_id: string }>);
  const accountCounts = countBy((accounts.data ?? []) as Array<{ household_id: string }>);
  const transactionCounts = countBy((transactions.data ?? []) as Array<{ household_id: string }>);
  const liveSub = new Map(
    (
      (subs.data ?? []) as Array<{
        household_id: string;
        plan_code: string;
        status: string;
        current_period_end: string | null;
      }>
    )
      .filter((s) => LIVE_STATUSES.has(s.status))
      .map((s) => [s.household_id, s]),
  );

  let rows = (households ?? []).map((h) => {
    const sub = liveSub.get(h.id as string);
    return projectAdminKeys(
      {
        household_id: h.id,
        household_name: h.name,
        country: (h as { country?: string }).country ?? null,
        created_at: h.created_at,
        plan_code: sub?.plan_code ?? null,
        subscription_status: sub?.status ?? null,
        current_period_end: sub?.current_period_end ?? null,
        grace_ends_at: null,
        is_comped: sub ? sub.plan_code === "comped" : null,
        member_count: memberCounts.get(h.id as string) ?? 0,
        account_count: accountCounts.get(h.id as string) ?? 0,
        transaction_count: transactionCounts.get(h.id as string) ?? 0,
      },
      ADMIN_HOUSEHOLD_KEYS,
    );
  });
  if (status) rows = rows.filter((r) => r.subscription_status === status);

  await auditAdminAction(ctx.admin, ctx.userId, "households.list", null);
  return adminJson({ households: rows });
}

async function getHouseholdDetail(
  ctx: NonNullable<Awaited<ReturnType<typeof requireAdmin>>>,
  id: string,
) {
  if (!UUID_RE.test(id)) return adminNotFound();

  const { data: household, error: householdError } = await ctx.admin
    .from("households")
    .select("id, name, country, created_at")
    .eq("id", id)
    .maybeSingle();
  if (householdError) throw householdError;
  if (!household) return adminNotFound();

  const { data: subs, error: subsError } = await ctx.admin
    .from("subscriptions")
    .select(
      "id, plan_code, provider, status, trial_ends_at, current_period_end, grace_ends_at, created_at, updated_at",
    )
    .eq("household_id", id)
    .order("created_at", { ascending: true });
  if (subsError) throw subsError;
  const subIds = (subs ?? []).map((s) => s.id as string);

  const [members, accounts, transactions, events] = await Promise.all([
    ctx.admin
      .from("household_members")
      .select("household_id", { count: "exact", head: true })
      .eq("household_id", id),
    ctx.admin
      .from("accounts")
      .select("household_id", { count: "exact", head: true })
      .eq("household_id", id),
    ctx.admin
      .from("transactions")
      .select("household_id", { count: "exact", head: true })
      .eq("household_id", id),
    subIds.length
      ? ctx.admin
          .from("billing_events")
          .select(
            "id, provider, provider_event_id, subscription_id, type, received_at, processed_at",
          )
          .in("subscription_id", subIds)
          .order("received_at", { ascending: true })
      : Promise.resolve({ data: [] as never[], error: null }),
  ]);
  if (members.error) throw members.error;
  if (accounts.error) throw accounts.error;
  if (transactions.error) throw transactions.error;
  if (events.error) throw events.error;

  const live = (subs ?? []).find((s) => LIVE_STATUSES.has(s.status as string));

  const summary = projectAdminKeys(
    {
      household_id: household.id,
      household_name: household.name,
      country: (household as { country?: string }).country ?? null,
      created_at: household.created_at,
      plan_code: (live?.plan_code as string | undefined) ?? null,
      subscription_status: (live?.status as string | undefined) ?? null,
      current_period_end: (live?.current_period_end as string | undefined) ?? null,
      grace_ends_at: (live?.grace_ends_at as string | undefined) ?? null,
      is_comped: live ? live.plan_code === "comped" : null,
      member_count: members.count ?? 0,
      account_count: accounts.count ?? 0,
      transaction_count: transactions.count ?? 0,
    },
    ADMIN_HOUSEHOLD_KEYS,
  );

  const history = (subs ?? []).map((s) =>
    projectAdminKeys(s as unknown as Record<string, unknown>, ADMIN_SUBSCRIPTION_KEYS),
  );
  const billingEvents = ((events.data ?? []) as unknown as Array<Record<string, unknown>>).map(
    (e) => projectAdminKeys(e, ADMIN_BILLING_EVENT_KEYS),
  );

  await auditAdminAction(ctx.admin, ctx.userId, "households.view", id);
  return adminJson({ household: summary, subscriptions: history, billingEvents });
}
