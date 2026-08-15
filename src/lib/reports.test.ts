import { describe, expect, it } from "vitest";
import { calculateRolling3MonthAverage, getReportDateRange } from "./reports";

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

    it("returns custom range when preset is custom", () => {
      const range = getReportDateRange("custom", timezone, mockNow, "2026-01-10", "2026-03-20");
      expect(range).toEqual({
        from: "2026-01-10",
        to: "2026-03-20",
      });
    });
  });

  describe("calculateRolling3MonthAverage", () => {
    it("calculates rolling 3-month average across values", () => {
      const data = [
        { period_month: "2026-01-01", net: 100 },
        { period_month: "2026-02-01", net: 200 },
        { period_month: "2026-03-01", net: 300 },
        { period_month: "2026-04-01", net: 400 },
      ];
      const result = calculateRolling3MonthAverage(data);
      expect(result).toEqual([
        100, // 100 / 1
        150, // (100 + 200) / 2
        200, // (100 + 200 + 300) / 3
        300, // (200 + 300 + 400) / 3
      ]);
    });
  });
});
