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
// Cadence: the six aggregate readers run live at most once per TTL —
// cheap indexed counts at current scale, fetched on mount plus an
// explicit Refresh in the UI (no polling). The canonical daily record
// stays reports/metrics via `npm run metrics:report`. See
// docs/metrics-cadence.md.
//
// TTL snapshot (not HTTP cache): responses stay `private, no-store` and
// every view still audits as `metrics.view` (the audit invariant in
// _shared.ts), but the heavy readers are shared across admins for five
// minutes instead of re-aggregating auth.users + transactions per mount.

import { adminJson, auditAdminAction, withAdmin } from "../_shared";
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

type MetricsSnapshot = {
  at: number;
  billingEnabled: boolean;
  activation: Row[] | null;
  funnel: Row[] | null;
  retention: Row[] | null;
  articles: Row[] | null;
  sources: Row[] | null;
  subscriptions: Row[] | null;
};

const METRICS_TTL_MS = 5 * 60 * 1000;
let snapshot: MetricsSnapshot | null = null;

/** Test-only: drop the TTL snapshot so tests observe live readers. */
export function __resetMetricsCacheForTests() {
  snapshot = null;
}

export async function GET(request: Request) {
  return withAdmin(request, async (ctx) => {
    const billingEnabled = isBillingEnabled();
    const now = Date.now();
    const cached =
      snapshot !== null &&
      snapshot.billingEnabled === billingEnabled &&
      now - snapshot.at < METRICS_TTL_MS
        ? snapshot
        : null;
    let activation: Row[] | null;
    let funnel: Row[] | null;
    let retention: Row[] | null;
    let articles: Row[] | null;
    let sources: Row[] | null;
    let subscriptions: Row[] | null;
    if (cached) {
      ({ activation, funnel, retention, articles, sources, subscriptions } = cached);
    } else {
      const [
        { data: activationData, error: activationError },
        { data: funnelData, error: funnelError },
        { data: retentionData, error: retentionError },
        { data: articlesData, error: articlesError },
        { data: sourcesData, error: sourcesError },
        { data: subscriptionsData, error: subscriptionsError },
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
      activation = (activationData ?? []) as Row[];
      funnel = (funnelData ?? []) as Row[];
      retention = (retentionData ?? []) as Row[];
      articles = (articlesData ?? []) as Row[];
      sources = (sourcesData ?? []) as Row[];
      subscriptions = (subscriptionsData ?? []) as Row[];
      snapshot = {
        at: now,
        billingEnabled,
        activation,
        funnel,
        retention,
        articles,
        sources,
        subscriptions,
      };
    }

    const activationRow = (activation ?? [])[0] ?? null;
    if (!activationRow) throw new Error("metrics activation reader returned no row");

    await auditAdminAction(ctx.db, "metrics.view", null);
    return adminJson({
      activation: projectAdminKeys(activationRow, ADMIN_METRIC_ACTIVATION_KEYS),
      funnel: (funnel ?? []).map((r) => projectAdminKeys(r, ADMIN_METRIC_FUNNEL_KEYS)),
      retention: (retention ?? []).map((r) => projectAdminKeys(r, ADMIN_METRIC_RETENTION_KEYS)),
      contentArticles: (articles ?? []).map((r) => projectAdminKeys(r, ADMIN_METRIC_ARTICLE_KEYS)),
      contentSources: (sources ?? []).map((r) => projectAdminKeys(r, ADMIN_METRIC_SOURCE_KEYS)),
      subscriptions: (subscriptions ?? []).map((r) =>
        projectAdminKeys(r, ADMIN_METRIC_SUBSCRIPTION_KEYS),
      ),
      ...(billingEnabled
        ? {
            revenue: {
              enabled: true,
              rows: [],
              note: "Revenue figures ship with the provider adapter — nothing collected yet.",
            },
          }
        : {}),
    });
  });
}
