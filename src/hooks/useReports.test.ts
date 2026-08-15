import { describe, expect, it } from "vitest";
import { reportCategoryTotalSchema, reportMonthlyTotalSchema } from "./useReports";

describe("reportCategoryTotalSchema", () => {
  it("parses a valid RPC row, coercing numeric-as-string PostgREST fields", () => {
    const parsed = reportCategoryTotalSchema.parse({
      category_id: "cat-1",
      category_name: "Food",
      color_hex: "#ef4444",
      total: "100.50",
      txn_count: "3",
    });
    expect(parsed).toEqual({
      category_id: "cat-1",
      category_name: "Food",
      color_hex: "#ef4444",
      total: 100.5,
      txn_count: 3,
    });
  });

  it("throws instead of silently defaulting to zero when total is missing", () => {
    expect(() =>
      reportCategoryTotalSchema.parse({
        category_id: null,
        category_name: null,
        color_hex: "#9ca3af",
        txn_count: 1,
      }),
    ).toThrow();
  });

  it("rejects a malformed color_hex instead of rendering garbage as a CSS color", () => {
    expect(() =>
      reportCategoryTotalSchema.parse({
        category_id: null,
        category_name: null,
        color_hex: "not-a-color",
        total: 10,
        txn_count: 1,
      }),
    ).toThrow();
  });
});

describe("reportMonthlyTotalSchema", () => {
  it("parses a valid RPC row", () => {
    const parsed = reportMonthlyTotalSchema.parse({
      period_month: "2026-08-01",
      income: "220",
      expense: "150",
      net: "70",
    });
    expect(parsed).toEqual({
      period_month: "2026-08-01",
      income: 220,
      expense: 150,
      net: 70,
    });
  });

  it("rejects a row whose net doesn't reconcile with income minus expense", () => {
    expect(() =>
      reportMonthlyTotalSchema.parse({
        period_month: "2026-08-01",
        income: 220,
        expense: 150,
        net: 999,
      }),
    ).toThrow();
  });
});
