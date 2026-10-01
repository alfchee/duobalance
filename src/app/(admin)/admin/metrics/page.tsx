"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { AdminGate } from "@/components/admin/admin-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

type Activation = {
  signed_up_users: number;
  active_households: number;
  setup_complete: number;
  budget_created: number;
  partner_joined: number;
  setup_and_partner_joined: number;
};

type FunnelStep = {
  step: number;
  name: string;
  reached: number;
  lost_at_step: number;
};

type RetentionRow = {
  cohort_week: string;
  households: number;
  week_2_active: number;
  week_2_eligible: number;
  week_3_active: number;
  week_3_eligible: number;
  week_4_active: number;
  week_4_eligible: number;
};

type ArticleRow = {
  slug: string;
  views: number;
  readers: number;
  d25: number;
  d50: number;
  d75: number;
  d100: number;
};

type SourceRow = { src: string; cnt: number };

type SubscriptionRow = {
  plan_code: string;
  status: string;
  households: number;
};

type RevenueSection = { enabled: boolean; rows: unknown[]; note: string };

type MetricsResponse = {
  activation: Activation;
  funnel: FunnelStep[];
  retention: RetentionRow[];
  contentArticles: ArticleRow[];
  contentSources: SourceRow[];
  subscriptions: SubscriptionRow[];
  revenue?: RevenueSection;
};

/** Same presentation formula as the report: counts divide, n/a on zero. */
function pct(numerator: number, denominator: number): string {
  if (!denominator) return "n/a";
  return `${((100 * numerator) / denominator).toFixed(1)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** Retention cell: the report's "active / eligible (rate%)", "not mature" at 0. */
function retentionCell(active: number, eligible: number): string {
  if (!eligible) return "not mature";
  return `${active} / ${eligible} (${pct(active, eligible)})`;
}

function serverMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body;
    if (typeof body === "object" && body !== null && "error" in body) {
      return String((body as { error: unknown }).error);
    }
  }
  return "Could not load metrics.";
}

// Admin metrics dashboard (#275): the generated report's numbers without
// running a script. Every section reads the same SQL definitions as
// scripts/generate-metrics-report.mjs (see metrics-admin-agreement.test.ts)
// through the admin_metrics_*() readers — aggregates only, no per-user or
// per-household drill-down, no transaction contents. Revenue renders only
// when the API includes the section (billing live); while the flag is off
// the key is absent and this section stays hidden.
//
// Refresh: fetched on mount plus the explicit Refresh button — no polling,
// no per-keystroke refetch (each load audits one `metrics.view` row).
// The canonical daily record stays reports/metrics via
// `npm run metrics:report`; see docs/metrics-cadence.md.
export default function AdminMetricsPage() {
  return (
    <AdminGate>
      <AdminMetrics />
    </AdminGate>
  );
}

function AdminMetrics() {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await apiFetch<MetricsResponse>("/api/admin/metrics");
      setData(res);
    } catch (err) {
      setError(serverMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, retryKey]);

  return (
    <div className="flex w-full flex-col gap-6">
      <Card className="w-full">
        <CardHeader>
          <h1 className="text-2xl font-black tracking-tight">Admin — metrics</h1>
          <CardDescription>
            Same definitions as the generated report, live from the database. Aggregates only.{" "}
            <Link href="/admin" className="underline">
              Back to households
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={() => {
                if (refreshing) return;
                setRetryKey((k) => k + 1);
              }}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : data === null ? (
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                Loading metrics…
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {data ? (
        <>
          <SubscriptionsCard rows={data.subscriptions} revenue={data.revenue} />
          <ActivationCard activation={data.activation} funnel={data.funnel} />
          <RetentionCard rows={data.retention} />
          <ContentCard articles={data.contentArticles} sources={data.contentSources} />
          <Card className="w-full">
            <CardContent className="pt-6 text-xs text-muted-foreground">
              Definitions match scripts/generate-metrics-report.mjs (pinned by test); numbers agree
              with the report generated the same day. Canonical daily record: reports/metrics via{" "}
              <span className="font-mono">npm run metrics:report</span> — see
              docs/metrics-cadence.md.
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function SubscriptionsCard({
  rows,
  revenue,
}: {
  rows: SubscriptionRow[];
  revenue?: RevenueSection;
}) {
  const total = rows.reduce((n, r) => n + r.households, 0);
  return (
    <Card className="w-full">
      <CardHeader>
        <h2 className="text-lg font-bold">Subscriptions by plan and status</h2>
        <CardDescription>
          {total} subscription rows across all statuses, live and expired.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subscriptions.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-4 font-semibold">Plan</th>
                <th className="py-1 pr-4 font-semibold">Status</th>
                <th className="py-1 text-right font-semibold">Subscriptions</th>
                <th className="py-1 text-right font-semibold">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.plan_code}-${r.status}`} className="border-t">
                  <td className="py-1 pr-4">
                    {r.plan_code}{" "}
                    {r.plan_code === "comped" ? (
                      <Badge variant="secondary" className="uppercase">
                        comped
                      </Badge>
                    ) : null}
                  </td>
                  <td className="py-1 pr-4">{r.status}</td>
                  <td className="py-1 text-right">{r.households}</td>
                  <td className="py-1 text-right text-muted-foreground">
                    {pct(r.households, total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {revenue ? (
          <div className="rounded-md border p-3">
            <h3 className="text-sm font-bold uppercase tracking-wide">Revenue</h3>
            <p className="mt-1 text-sm text-muted-foreground">{revenue.note}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ActivationCard({
  activation: a,
  funnel,
}: {
  activation: Activation;
  funnel: FunnelStep[];
}) {
  return (
    <Card className="w-full">
      <CardHeader>
        <h2 className="text-lg font-bold">Activation funnel</h2>
        <CardDescription>
          {a.active_households} active households · {a.setup_complete} setup-complete (
          {pct(a.setup_complete, a.active_households)}) · {a.partner_joined} partner-joined (
          {pct(a.partner_joined, a.active_households)}) · {a.budget_created} budget-created.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {funnel.length === 0 ? (
          <p className="text-sm text-muted-foreground">No funnel data.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-4 font-semibold">Step</th>
                <th className="py-1 pr-4 text-right font-semibold">Reached</th>
                <th className="py-1 pr-4 text-right font-semibold">Lost at step</th>
                <th className="py-1 text-right font-semibold">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {funnel.map((s) => (
                <tr key={s.step} className="border-t">
                  <td className="py-1 pr-4">{s.name}</td>
                  <td className="py-1 pr-4 text-right">{s.reached}</td>
                  <td className="py-1 pr-4 text-right">{s.lost_at_step}</td>
                  <td className="py-1 text-right text-muted-foreground">
                    {pct(s.reached, funnel[0]?.reached ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function RetentionCard({ rows }: { rows: RetentionRow[] }) {
  return (
    <Card className="w-full">
      <CardHeader>
        <h2 className="text-lg font-bold">Retention by household cohort</h2>
        <CardDescription>
          Signup week cohorts; each cell reads active / eligible (rate). Windows whose households
          have not matured show as such instead of 0%.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No retention data.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-4 font-semibold">Signup week</th>
                <th className="py-1 pr-4 text-right font-semibold">Households</th>
                <th className="py-1 pr-4 text-right font-semibold">Week 2</th>
                <th className="py-1 pr-4 text-right font-semibold">Week 3</th>
                <th className="py-1 text-right font-semibold">Week 4</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cohort_week} className="border-t">
                  <td className="py-1 pr-4">{formatDate(r.cohort_week)}</td>
                  <td className="py-1 pr-4 text-right">{r.households}</td>
                  <td className="py-1 pr-4 text-right">
                    {retentionCell(r.week_2_active, r.week_2_eligible)}
                  </td>
                  <td className="py-1 pr-4 text-right">
                    {retentionCell(r.week_3_active, r.week_3_eligible)}
                  </td>
                  <td className="py-1 text-right">
                    {retentionCell(r.week_4_active, r.week_4_eligible)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function ContentCard({ articles, sources }: { articles: ArticleRow[]; sources: SourceRow[] }) {
  const totalOpens = sources.reduce((n, s) => n + s.cnt, 0);
  return (
    <Card className="w-full">
      <CardHeader>
        <h2 className="text-lg font-bold">Content engagement</h2>
        <CardDescription>
          Aggregate reads only — no per-user reading history. Completion is depth-100 reach over
          views, same formula as the report.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section aria-label="Per-article engagement">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">Per article</h3>
          {articles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No guide opens recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-4 font-semibold">Article</th>
                  <th className="py-1 pr-2 text-right font-semibold">Views</th>
                  <th className="py-1 pr-2 text-right font-semibold">Readers</th>
                  <th className="py-1 pr-2 text-right font-semibold">25%</th>
                  <th className="py-1 pr-2 text-right font-semibold">50%</th>
                  <th className="py-1 pr-2 text-right font-semibold">75%</th>
                  <th className="py-1 pr-2 text-right font-semibold">100%</th>
                  <th className="py-1 text-right font-semibold">Completion</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((a) => (
                  <tr key={a.slug} className="border-t">
                    <td className="max-w-48 truncate py-1 pr-4 font-mono text-xs">{a.slug}</td>
                    <td className="py-1 pr-2 text-right">{a.views}</td>
                    <td className="py-1 pr-2 text-right">{a.readers}</td>
                    <td className="py-1 pr-2 text-right">{a.d25}</td>
                    <td className="py-1 pr-2 text-right">{a.d50}</td>
                    <td className="py-1 pr-2 text-right">{a.d75}</td>
                    <td className="py-1 pr-2 text-right">{a.d100}</td>
                    <td className="py-1 text-right text-muted-foreground">
                      {pct(a.d100, a.views)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section aria-label="Opens by source">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide">Opens by source</h3>
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No guide opens recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-4 font-semibold">Source</th>
                  <th className="py-1 pr-4 text-right font-semibold">Opens</th>
                  <th className="py-1 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.src} className="border-t">
                    <td className="py-1 pr-4 font-mono text-xs">{s.src}</td>
                    <td className="py-1 pr-4 text-right">{s.cnt}</td>
                    <td className="py-1 text-right text-muted-foreground">
                      {pct(s.cnt, totalOpens)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
