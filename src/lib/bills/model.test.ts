import { describe, expect, it } from "vitest";
import {
  calculateBillWeekTotal,
  createBillInstancesByDate,
  createBillStatusCounts,
  createBillWeeks,
  formatBillDate,
  getBillMonthWindow,
  getBillStatus,
  moveBillMonth,
  type SelectedBillInstance,
} from "./model";

function instance(overrides: Record<string, unknown> = {}): SelectedBillInstance {
  return {
    bill: { currency: "USD", id: "bill-1", instances: [] },
    instance: {
      amount: 10,
      due_on: "2026-08-03",
      effective_status: "due",
      id: "instance-1",
      ...overrides,
    },
  } as unknown as SelectedBillInstance;
}

describe("bills model", () => {
  it("calculates month boundaries and navigates across years", () => {
    expect(getBillMonthWindow("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(moveBillMonth("2026-01", -1)).toBe("2025-12");
  });

  it("groups instances by date and Monday-based week", () => {
    const values = [instance(), instance({ due_on: "2026-08-04", id: "instance-2" })];
    expect(createBillInstancesByDate(values).get("2026-08-03")).toHaveLength(1);
    expect(createBillWeeks(values)).toEqual([["2026-08-03", values]]);
  });

  it("counts statuses and excludes skipped instances from currency totals", () => {
    const values = [
      instance({ effective_status: "paid" }),
      instance({ effective_status: "overdue", id: "instance-2" }),
      instance({ effective_status: "skipped", id: "instance-3" }),
    ];
    expect(createBillStatusCounts(values)).toEqual({ due: 0, overdue: 1, paid: 1, skipped: 1 });
    expect(calculateBillWeekTotal(values, "en")).toBe("$20.00");
  });

  it("normalizes unknown statuses and safely ignores undated instances", () => {
    expect(getBillStatus("unknown")).toBe("due");
    expect(getBillStatus(null)).toBe("due");
    expect(createBillInstancesByDate([instance({ due_on: null })])).toEqual(new Map());
    expect(formatBillDate("2026-08-03", "en")).toBe("Aug 3");
  });
});
