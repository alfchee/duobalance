import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const reportMjs = readFileSync(
  path.resolve(dirname, "../../scripts/generate-metrics-report.mjs"),
  "utf8",
);
const migration = readFileSync(
  path.resolve(dirname, "../../supabase/migrations/20261001000004_admin_metrics_dashboard_275.sql"),
  "utf8",
);

// Issue #275: the dashboard must read from the same SQL definitions as the
// generated report rather than reimplementing them. Node and Postgres share
// no SQL module system, so the migration carries the report's CTEs verbatim
// (only the final SELECT differs: structured rows instead of markdown).
// These fragments are the semantic core of each shared definition —
// predicates, step order, window expressions, source lists. If either side
// edits its logic without the other, this test fails: agreement is
// referenced (mechanically verified), not trusted.
const SHARED_FRAGMENTS = [
  // Activation summary: active-household, setup-complete, budget, and
  // partner predicates — every EXISTS / join condition that decides a
  // count, so no predicate can drift unnoticed.
  "h.deleted_at is null",
  "and not a.is_archived",
  "exists (select 1 from public.transactions t where t.household_id = h.id)",
  "exists (select 1 from public.budgets b where b.household_id = h.id)",
  "m.household_id = h.id and m.removed_at is null) >= 2",
  "m.removed_at is null and m.role = 'owner'",
  "m.role = 'partner' and m.removed_at is null",
  // Funnel: ordered steps, drop-off step list, clamped loss. (The
  // furthest-step CASE lives in the per-household table, which the
  // dashboard excludes by AC — so it is pinned here by absence below.)
  "1 — Signed up",
  "8 — Partner accepted",
  "(1, '1 — Signed up', (select signed_up from funnel_counts))",
  "(8, '8 — Partner accepted', (select partner_accepted from funnel_counts))",
  "greatest(lag(s.reached) over (order by s.step) - s.reached, 0)",
  "m.role = 'owner'",
  "i.role = 'partner'",
  // Retention: cohort grouping, every eligibility filter, every window.
  "date_trunc('week', created_at) as cohort_week",
  "count(*) filter (where now() >= c.created_at + interval '2 weeks')",
  "count(*) filter (where now() >= c.created_at + interval '3 weeks')",
  "count(*) filter (where now() >= c.created_at + interval '4 weeks')",
  "t.created_at >= c.created_at + interval '1 week' and t.created_at < c.created_at + interval '2 weeks'",
  "t.created_at >= c.created_at + interval '3 weeks' and t.created_at < c.created_at + interval '4 weeks'",
  // Content: mount sources and every depth anchor, scroll exclusion.
  "source in ('guide-view', 'help-center')",
  "anchor = 'depth-25'",
  "anchor = 'depth-50'",
  "anchor = 'depth-75'",
  "anchor = 'depth-100'",
  "source is distinct from 'guide-scroll'",
];

describe("metrics dashboard ↔ report agreement (#275)", () => {
  it("every shared definition fragment exists in the report script", () => {
    for (const fragment of SHARED_FRAGMENTS) {
      expect(reportMjs, `report script must contain: ${fragment}`).toContain(fragment);
    }
  });

  it("every shared definition fragment exists in the dashboard migration", () => {
    for (const fragment of SHARED_FRAGMENTS) {
      expect(migration, `dashboard migration must contain: ${fragment}`).toContain(fragment);
    }
  });

  it("dashboard-only definitions stay out of the report (and vice versa)", () => {
    // Subscription counts are new in #275 — the report has no billing
    // section, so there is nothing to share. If the report ever gains one,
    // this fails and the dashboard must be rewired to it.
    expect(reportMjs).not.toContain("admin_metrics_subscriptions");
    // Markdown escaping is the report artifact's presentation, not a metric
    // definition — the JSON dashboard must not inherit it. Likewise the
    // per-household furthest-step CASE stays report-only (no per-row
    // drill into financial behaviour on the dashboard).
    expect(migration).not.toContain("replace(replace(s.slug");
    expect(migration).not.toContain("when p.partner_joined_at is not null then 8");
  });
});
