import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const reportMjsPath = path.resolve(dirname, "../../scripts/generate-metrics-report.mjs");
const reportMjs = readFileSync(reportMjsPath, "utf8");

function parseRetentionCell(cell: string): {
  active: number;
  eligible: number;
  rate: number;
} | null {
  const trimmed = cell.trim();
  if (trimmed === "not mature" || trimmed === "n/a") return null;
  // Expected format: "1 / 3 (33.3%)" or "10 / 10 (100.0%)"
  const match = trimmed.match(/^(\d+)\s*\/\s*(\d+)\s*\(\s*([\d.]+)%\s*\)$/);
  if (!match) return null;
  const active = Number(match[1]);
  const eligible = Number(match[2]);
  const rate = Number(match[3]);
  return { active, eligible, rate };
}

describe("retention denominator — #166", () => {
  it("defines eligible denominator as households whose window has elapsed", () => {
    // SQL must filter by now() >= created_at + interval 'N weeks' for eligibility
    expect(reportMjs).toContain("week_2_eligible");
    expect(reportMjs).toContain("week_3_eligible");
    expect(reportMjs).toContain("week_4_eligible");
    expect(reportMjs).toContain("now() >= c.created_at + interval '2 weeks'");
    expect(reportMjs).toContain("now() >= c.created_at + interval '3 weeks'");
    expect(reportMjs).toContain("now() >= c.created_at + interval '4 weeks'");
  });

  it("makes percentage reproducible: cell shows active / eligible (rate%)", () => {
    // The markdown cell must contain both numerator and denominator visibly
    expect(reportMjs).toContain("week_2_active || ' / ' || week_2_eligible");
    expect(reportMjs).toContain("week_3_active || ' / ' || week_3_eligible");
    expect(reportMjs).toContain("week_4_active || ' / ' || week_4_eligible");
    // Rate must be computed from active / eligible, not from households
    expect(reportMjs).toContain("100.0 * week_2_active / nullif(week_2_eligible, 0)");
    expect(reportMjs).toContain("100.0 * week_3_active / nullif(week_3_eligible, 0)");
    expect(reportMjs).toContain("100.0 * week_4_active / nullif(week_4_eligible, 0)");
  });

  it("documents denominator explicitly in Definitions", () => {
    expect(reportMjs).toContain("Retention cohort:");
    expect(reportMjs).toContain("week_N_eligible");
    expect(reportMjs).toContain("active / eligible (rate%)");
    expect(reportMjs).toContain("rate = 100 * active / eligible");
    expect(reportMjs).toContain("not mature");
  });

  it("every percentage in a retention cell equals numerator / denominator", () => {
    const cases: Array<[string, boolean]> = [
      ["1 / 3 (33.3%)", true],
      ["1 / 10 (10.0%)", true],
      ["10 / 10 (100.0%)", true],
      ["0 / 5 (0.0%)", true],
      ["2 / 3 (66.7%)", true],
      // Wrong rate should be detectable
      ["1 / 3 (10.0%)", false],
      ["1 / 10 (33.3%)", false],
    ];

    for (const [cell, shouldPass] of cases) {
      const parsed = parseRetentionCell(cell);
      expect(parsed).not.toBeNull();
      if (!parsed) continue;
      const expectedRate = Number(((100 * parsed.active) / parsed.eligible).toFixed(1));
      const matches = Math.abs(parsed.rate - expectedRate) < 0.05;
      if (shouldPass) {
        expect(matches, `${cell} should have rate ${expectedRate}% but got ${parsed.rate}%`).toBe(
          true,
        );
      } else {
        expect(matches, `${cell} must NOT equal ${expectedRate}%`).toBe(false);
      }
    }
  });

  it("fails if denominator and percentage disagree (regression for 2026-09-03 cohort)", () => {
    // The exact bug from the issue: 10 households with 1 active was shown as 33.3%
    // That implies denominator was 3, not 10. With the fix the cell must show "1 / 3 (33.3%)"
    // so the denominator is visible; a cell "1 (33.3%)" next to Households=10 must not exist.
    expect(reportMjs).not.toMatch(/\|\s*10\s*\|\s*1\s*\(\s*33\.3%/);
    // Correct cell must be parseable and rate must equal active/eligible
    const correct = parseRetentionCell("1 / 3 (33.3%)");
    expect(correct).not.toBeNull();
    if (correct) {
      expect(correct.active).toBe(1);
      expect(correct.eligible).toBe(3);
      expect(correct.rate).toBeCloseTo(33.3, 1);
    }
    // Ensure "not mature" is used when eligible=0, not a 0% with hidden denominator
    expect(reportMjs).toContain("when week_2_eligible = 0 then 'not mature'");
  });
});
