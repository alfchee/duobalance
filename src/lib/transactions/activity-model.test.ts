import { describe, expect, it } from "vitest";
import { activityDaySubtotal, groupActivityByDay, summarizeActivity } from "./activity-model";

const transactions = [
  { amount: -20, base_amount: -20, occurred_on: "2026-08-11", transfer_group_id: null },
  { amount: 40, base_amount: 40, occurred_on: "2026-08-11", transfer_group_id: null },
  { amount: -15, base_amount: -15, occurred_on: "2026-08-10", transfer_group_id: "transfer-1" },
  { amount: -3, base_amount: null, occurred_on: "2026-08-10", transfer_group_id: null },
] as const;

describe("activity model", () => {
  it("keeps transfers in the count while excluding them from cash-flow totals", () => {
    expect(summarizeActivity(transactions)).toEqual({ count: 4, inflow: 40, outflow: 20 });
  });

  it("groups records in input order and calculates transfer-free daily subtotals", () => {
    expect(groupActivityByDay(transactions)).toEqual([
      { date: "2026-08-11", subtotal: 20, transactions: transactions.slice(0, 2) },
      { date: "2026-08-10", subtotal: 0, transactions: transactions.slice(2) },
    ]);
    expect(activityDaySubtotal(transactions.slice(2))).toBe(0);
  });
});
