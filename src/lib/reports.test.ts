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

    it("handles invalid timezone gracefully without throwing", () => {
      const range = getReportDateRange("this_month", "Invalid/Timezone_Name", mockNow);
      expect(range).toEqual({
        from: "2026-08-01",
        to: "2026-08-31",
      });
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
  });
});
