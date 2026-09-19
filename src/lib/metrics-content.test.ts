import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const reportMjsPath = path.resolve(dirname, "../../scripts/generate-metrics-report.mjs");
const reportMjs = readFileSync(reportMjsPath, "utf8");

// Mirrors the exposure rule in "Time to First Transaction — by Guide Exposure":
// a mount (guide-view/help-center) before the first transaction counts;
// mounts after the first transaction do not; users with no transaction yet
// count as viewed if they ever mounted an article.
function isExposed(mounts: string[], firstTransactionAt: string | null): boolean {
  if (mounts.length === 0) return false;
  if (firstTransactionAt === null) return true;
  return mounts.some((m) => m < firstTransactionAt);
}

describe("content engagement against activation — #208", () => {
  it("measures per-article views, scroll depth and completion", () => {
    expect(reportMjs).toContain("Content Engagement — Per-Article Views and Completion");
    // Views are mount events; depth reach comes from scroll pings
    expect(reportMjs).toContain("source in ('guide-view', 'help-center')");
    expect(reportMjs).toContain("source = 'guide-scroll'");
    expect(reportMjs).toContain("anchor = 'depth-100'");
    expect(reportMjs).toContain("Completion");
    // Readers are an aggregate distinct-user count, not identities
    expect(reportMjs).toContain("count(distinct user_id)");
  });

  it("attributes guide opens to a source", () => {
    expect(reportMjs).toContain("Content Engagement — Opens by Source");
    expect(reportMjs).toContain("public.guide_opens");
    // Scroll pings are navigation noise, not opens
    expect(reportMjs).toContain("is distinct from 'guide-scroll'");
    // Placements named so the summary answers which earns the reads
    expect(reportMjs).toContain("landing-hero");
    expect(reportMjs).toContain("balances-empty");
    expect(reportMjs).toContain("utm_source=launch_email");
  });

  it("segments time-to-first-transaction by guide exposure while keeping the pre-launch baseline", () => {
    expect(reportMjs).toContain("Time to First Transaction — by Guide Exposure");
    expect(reportMjs).toContain("Viewed guide before first transaction");
    expect(reportMjs).toContain("Did not view guide");
    expect(reportMjs).toContain("Activation rate");
    expect(reportMjs).toContain("percentile_cont(0.5)");
    // The pre-launch baseline the exposure section builds on must stay intact
    expect(reportMjs).toContain("Baseline before the starter guide");
    expect(reportMjs).toContain("cannot be reconstructed afterwards");
    // Exposure rule: mount before first transaction counts, mount after does not
    expect(isExposed(["2026-09-18 01:00+00"], "2026-09-18 02:00+00")).toBe(true);
    expect(isExposed(["2026-09-18 03:00+00"], "2026-09-18 02:00+00")).toBe(false);
    expect(isExposed(["2026-09-18 03:00+00"], null)).toBe(true);
    expect(isExposed([], "2026-09-18 02:00+00")).toBe(false);
    expect(isExposed([], null)).toBe(false);
  });

  it("excludes negative time-to-first anomalies from exposure medians like the distribution section", () => {
    expect(reportMjs).toContain(
      "where u.first_transaction_at is not null and u.first_transaction_at - u.signed_up_at >= interval '0'",
    );
    expect(reportMjs).toContain(
      "and u2.first_transaction_at is not null and u2.first_transaction_at - u2.signed_up_at >= interval '0'",
    );
  });

  it("escapes article slugs and sources so a rogue row cannot break the markdown tables", () => {
    expect(reportMjs).toContain("replace(replace(s.slug, '|', '/')");
    expect(reportMjs).toContain("replace(replace(o.src, '|', '/')");
  });

  it("keeps the summary in the existing metrics report with aggregate-only reading data", () => {
    // New sections live in the same report script, not a separate tool
    expect(reportMjs).toContain("Content Engagement — Per-Article Views and Completion");
    expect(reportMjs).toContain("Content Engagement — Opens by Source");
    expect(reportMjs).toContain("Time to First Transaction — by Guide Exposure");
    // No per-user reading history in the report
    expect(reportMjs).toContain("aggregate counts only");
    expect(reportMjs).toContain("no per-user reading history appears in this report");
    // Definitions document the new sections
    expect(reportMjs).toContain("Content engagement — per-article:");
    expect(reportMjs).toContain("Content engagement — by source:");
    expect(reportMjs).toContain("Time to first transaction — by guide exposure:");
    expect(reportMjs).toContain("Content privacy:");
  });
});
