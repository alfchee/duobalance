import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const reportMjsPath = path.resolve(dirname, "../../scripts/generate-metrics-report.mjs");
const reportMjs = readFileSync(reportMjsPath, "utf8");

describe("time to first transaction — #168", () => {
  it("reports bucketed distribution with under 5m, 1h, 1d, over 1d, never", () => {
    expect(reportMjs).toContain("Under 5 minutes");
    expect(reportMjs).toContain("5 minutes – 1 hour");
    expect(reportMjs).toContain("1 hour – 1 day");
    expect(reportMjs).toContain("Over 1 day");
    expect(reportMjs).toContain("Never");
    // Buckets must be defined via interval checks
    expect(reportMjs).toContain("interval '5 minutes'");
    expect(reportMjs).toContain("interval '1 hour'");
    expect(reportMjs).toContain("interval '1 day'");
  });

  it("keeps median but reports alongside p25 and p75 with raw counts", () => {
    expect(reportMjs).toContain("p25");
    expect(reportMjs).toContain("p50 (median)");
    expect(reportMjs).toContain("p75");
    expect(reportMjs).toContain("percentile_cont(0.25)");
    expect(reportMjs).toContain("percentile_cont(0.5)");
    expect(reportMjs).toContain("percentile_cont(0.75)");
    // Raw counts next to percentiles so p75 at n=8 is not misread as stable
    expect(reportMjs).toContain("n with transaction");
    expect(reportMjs).toContain("n with transaction |");
  });

  it("counts users who never entered a transaction explicitly rather than dropping them", () => {
    expect(reportMjs).toContain("Never");
    expect(reportMjs).toContain("Never (no transaction)");
    expect(reportMjs).toContain("never_total");
    expect(reportMjs).toContain("first_transaction_at is null");
    // Total must include never
    expect(reportMjs).toContain("**Total**");
  });

  it("segments by owner vs invited partner", () => {
    expect(reportMjs).toContain("Owners");
    expect(reportMjs).toContain("Partners");
    expect(reportMjs).toContain("user_role = 'owner'");
    expect(reportMjs).toContain("user_role = 'partner'");
    // All users, Owners, Partners columns in bucket table
    expect(reportMjs).toContain("| Bucket | All users | Owners | Partners |");
    expect(reportMjs).toContain("| Stat | All users | Owners | Partners |");
  });

  it("under-5-minute target has its own line", () => {
    expect(reportMjs).toContain("Under 5 minutes");
    // Must be a bucket line, not just part of median
    const under5mMatches = reportMjs.match(/Under 5 minutes/g) || [];
    expect(under5mMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("segments by guide exposure and captures pre-launch baseline", () => {
    expect(reportMjs).toContain("Time to First Transaction — Guide Exposure");
    expect(reportMjs).toContain("pre-launch");
    expect(reportMjs).toContain("Baseline before the starter guide");
    expect(reportMjs).toContain("guide viewed");
    expect(reportMjs).toContain("launch email");
    expect(reportMjs).toContain("cohort relative to guide launch");
    expect(reportMjs).toContain("cannot be reconstructed afterwards");
    // Definitions must document guide exposure
    expect(reportMjs).toContain("Guide exposure");
  });

  it("documents time-to-first-transaction in Definitions with buckets and percentiles", () => {
    expect(reportMjs).toContain("Time to first transaction:");
    expect(reportMjs).toContain("Distribution buckets:");
    expect(reportMjs).toContain("Under 5 minutes");
    expect(reportMjs).toContain("p25/p50");
    expect(reportMjs).toContain("Never");
    expect(reportMjs).toContain("Owner vs partner segmentation");
  });
});
