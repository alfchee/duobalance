// GET /api/admin/metrics — metrics dashboard (#275).
//
// One round trip returning every dashboard section, each read through its
// admin_metrics_*() DEFINER reader on the caller-scoped client: the same
// SQL definitions as the generated report
// (scripts/generate-metrics-report.mjs), structured instead of markdown.
// Fragment agreement between the two is pinned by
// src/lib/metrics-admin-agreement.test.ts, so either side drifting breaks
// the build; same predicates over the same live tables means the dashboard
// and the report agree for the same date by construction.
//
// Rows are projected through the metric allowlists in lib/admin/scope.ts
// as defense in depth (counts and labels only — no identifiers, contents,
// or amounts). Reads audit once as `metrics.view`.
//
// Revenue: there is no revenue data source yet (no prices, no provider),
// so there is deliberately no revenue reader. While the billing flag is
// off the response carries no revenue key at all and the UI hides the
// section; once on, the response carries an explicit empty placeholder
// until the provider adapter (#268/Phase B) collects figures. The flag
// check is route-layer, like every other billing surface (#262).
//
// Cadence: this route runs the aggregate readers live on each call —
// cheap indexed counts at current scale, fetched on mount plus an
// explicit Refresh in the UI (no polling). The canonical daily record
// stays reports/metrics via `npm run metrics:report`. See
// docs/metrics-cadence.md.

import {
  adminJson,
  adminNotFound,
  auditAdminAction,
  requireAdmin,
  ADMIN_NO_STORE_HEADERS,
} from "../_shared";
import {
  projectAdminKeys,
  ADMIN_METRIC_ACTIVATION_KEYS,
  ADMIN_METRIC_ARTICLE_KEYS,
  ADMIN_METRIC_FUNNEL_KEYS,
  ADMIN_METRIC_RETENTION_KEYS,
  ADMIN_METRIC_SOURCE_KEYS,
  ADMIN_METRIC_SUBSCRIPTION_KEYS,
} from "@/lib/admin/scope";
import { isBillingEnabled } from "@/lib/billing/enabled";

export const revalidate = 1;

type Row = Record<string, unknown>;

export async function GET(request: Request) {
  if (process.env.BUILD_TARGET === "tauri") {
    return Response.json(
      { error: "not found" },
      { status: 404, headers: { ...ADMIN_NO_STORE_HEADERS } },
    );
  }
  const ctx = await requireAdmin(request);
  if (!ctx) return adminNotFound();

  const [
    { data: activation, error: activationError },
    { data: funnel, error: funnelError },
    { data: retention, error: retentionError },
    { data: articles, error: articlesError },
    { data: sources, error: sourcesError },
    { data: subscriptions, error: subscriptionsError },
  ] = await Promise.all([
    ctx.db.rpc("admin_metrics_activation"),
    ctx.db.rpc("admin_metrics_funnel"),
    ctx.db.rpc("admin_metrics_retention"),
    ctx.db.rpc("admin_metrics_content_articles"),
    ctx.db.rpc("admin_metrics_content_sources"),
    ctx.db.rpc("admin_metrics_subscriptions"),
  ]);
  for (const error of [
    activationError,
    funnelError,
    retentionError,
    articlesError,
    sourcesError,
    subscriptionsError,
  ]) {
    if (error) throw error;
  }

  const activationRow = ((activation ?? []) as Row[])[0] ?? null;
  if (!activationRow) throw new Error("metrics activation reader returned no row");

  await auditAdminAction(ctx.db, "metrics.view", null);
  return adminJson({
    activation: projectAdminKeys(activationRow, ADMIN_METRIC_ACTIVATION_KEYS),
    funnel: ((funnel ?? []) as Row[]).map((r) => projectAdminKeys(r, ADMIN_METRIC_FUNNEL_KEYS)),
    retention: ((retention ?? []) as Row[]).map((r) =>
      projectAdminKeys(r, ADMIN_METRIC_RETENTION_KEYS),
    ),
    contentArticles: ((articles ?? []) as Row[]).map((r) =>
      projectAdminKeys(r, ADMIN_METRIC_ARTICLE_KEYS),
    ),
    contentSources: ((sources ?? []) as Row[]).map((r) =>
      projectAdminKeys(r, ADMIN_METRIC_SOURCE_KEYS),
    ),
    subscriptions: ((subscriptions ?? []) as Row[]).map((r) =>
      projectAdminKeys(r, ADMIN_METRIC_SUBSCRIPTION_KEYS),
    ),
    ...(isBillingEnabled()
      ? {
          revenue: {
            enabled: true,
            rows: [],
            note: "Revenue figures ship with the provider adapter — nothing collected yet.",
          },
        }
      : {}),
  });
}
