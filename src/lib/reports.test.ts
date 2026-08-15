import { describe, expect, it, vi } from "vitest";
import {
  calculateRolling3MonthAverage,
  densifyMonthlyTotals,
  formatReportMonthLabel,
  getReportDateRange,
} from "./reports";

describe("reports lib", () => {
  const mockNow = new Date("2026-08-15T12:00:00Z");
  const timezone = "America/Managua";

  describe("getReportDateRange", () => {
    it("computes this_month range correctly", () => {
      const range = getReportDateRange("this_month", timezone, mockNow);
      expect(range).toEqual({
        from: "2026-08-01",
        to: "2026-08-31",
      });
    });

    it("computes 3m range correctly", () => {
      const range = getReportDateRange("3m", timezone, mockNow);
      expect(range).toEqual({
        from: "2026-06-01",
        to: "2026-08-31",
      });
    });

    it("computes 6m range correctly", () => {
      const range = getReportDateRange("6m", timezone, mockNow);
      expect(range).toEqual({
        from: "2026-03-01",
        to: "2026-08-31",
      });
    });

    it("computes 12m range correctly", () => {
      const range = getReportDateRange("12m", timezone, mockNow);
      expect(range).toEqual({
        from: "2025-09-01",
        to: "2026-08-31",
      });
    });

    it("computes ytd range correctly", () => {
      const range = getReportDateRange("ytd", timezone, mockNow);
      expect(range).toEqual({
        from: "2026-01-01",
        to: "2026-08-31",
      });
    });

    it("handles year rollback when current month is January", () => {
      const janNow = new Date("2026-01-15T12:00:00Z");
      const range3m = getReportDateRange("3m", timezone, janNow);
      expect(range3m).toEqual({
        from: "2025-11-01",
        to: "2026-01-31",
      });

      const range6m = getReportDateRange("6m", timezone, janNow);
      expect(range6m).toEqual({
        from: "2025-08-01",
        to: "2026-01-31",
      });
    });

    it("handles leap year February correctly", () => {
      const feb2024 = new Date("2024-02-10T12:00:00Z");
      const range = getReportDateRange("this_month", timezone, feb2024);
      expect(range).toEqual({
        from: "2024-02-01",
        to: "2024-02-29",
      });
    });

    it("handles invalid timezone gracefully without throwing, but logs the fallback", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const range = getReportDateRange("this_month", "Invalid/Timezone_Name", mockNow);
      expect(range).toEqual({
        from: "2026-08-01",
        to: "2026-08-31",
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid household timezone "Invalid/Timezone_Name"'),
        expect.anything(),
      );
      errorSpy.mockRestore();
    });

    it("returns custom range when preset is custom and dates are provided", () => {
      const range = getReportDateRange("custom", timezone, mockNow, "2026-01-10", "2026-03-20");
      expect(range).toEqual({
        from: "2026-01-10",
        to: "2026-03-20",
      });
    });

    it("returns empty bounds when custom preset has incomplete dates", () => {
      const range = getReportDateRange("custom", timezone, mockNow, "2026-01-10", "");
      expect(range).toEqual({
        from: "2026-01-10",
        to: "",
      });
    });
  });

  describe("calculateRolling3MonthAverage", () => {
    it("calculates rolling 3-month average across positive and negative values", () => {
      const data = [
        { period_month: "2026-01-01", net: 100 },
        { period_month: "2026-02-01", net: -200 },
        { period_month: "2026-03-01", net: 300 },
        { period_month: "2026-04-01", net: -400 },
      ];
      const result = calculateRolling3MonthAverage(data);
      expect(result).toEqual([
        100, // 100 / 1
        -50, // (100 - 200) / 2 = -100 / 2
        200 / 3, // (100 - 200 + 300) / 3 = 200 / 3
        -300 / 3, // (-200 + 300 - 400) / 3 = -100
      ]);
    });

    it("is skewed by a gap in the source data — densifying first fixes it", () => {
      // Without a January row, the "3-month average" for March is really
      // averaging January and March only under a February label.
      const gappy = [
        { period_month: "2026-01-01", net: 300 },
        { period_month: "2026-03-01", net: 300 },
      ];
      const skewed = calculateRolling3MonthAverage(gappy);
      expect(skewed).toEqual([300, 300]);

      const dense = densifyMonthlyTotals(
        [
          { period_month: "2026-01-01", income: 300, expense: 0, net: 300 },
          { period_month: "2026-03-01", income: 300, expense: 0, net: 300 },
        ],
        "2026-01-01",
        "2026-03-31",
        { income: 0, expense: 0, net: 0 },
      );
      expect(dense.map((d) => d.period_month)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
      expect(calculateRolling3MonthAverage(dense)).toEqual([300, 150, 200]);
    });
  });

  describe("densifyMonthlyTotals", () => {
    it("fills gaps in the middle of the range with zero rows", () => {
      const result = densifyMonthlyTotals(
        [{ period_month: "2026-06-01", income: 10, expense: 4, net: 6 }],
        "2026-05-01",
        "2026-07-31",
        { income: 0, expense: 0, net: 0 },
      );
      expect(result).toEqual([
        { period_month: "2026-05-01", income: 0, expense: 0, net: 0 },
        { period_month: "2026-06-01", income: 10, expense: 4, net: 6 },
        { period_month: "2026-07-01", income: 0, expense: 0, net: 0 },
      ]);
    });

    it("returns an empty array untouched, preserving the dedicated empty state", () => {
      const result = densifyMonthlyTotals<{
        period_month: string;
        income: number;
        expense: number;
        net: number;
      }>([], "2026-01-01", "2026-03-31", { income: 0, expense: 0, net: 0 });
      expect(result).toEqual([]);
    });
  });

  describe("formatReportMonthLabel", () => {
    it("labels a date-only period_month in UTC regardless of the caller's timezone", () => {
      // The historical bug: formatting in a negative-offset timezone rolled
      // 2026-08-01T00:00:00Z back to July 31st, mislabeling the whole month.
      expect(formatReportMonthLabel("2026-08-01", "en")).toBe("Aug 26");
    });
  });
});
