import { describe, expect, it } from "vitest";
import {
  adjustCopyBudgetDrafts,
  buildBudgetTransactionsHref,
  calculateBudgetSummary,
  createCopyBudgetInputs,
  createBudgetRows,
  createCopyBudgetDrafts,
  getBudgetMonthEnd,
  getBudgetMonthLabel,
  getBudgetProgress,
  moveBudgetMonth,
  replaceCopyBudgetDraftAmount,
} from "./model";

describe("budget domain model", () => {
  const categories = [
    { id: "groceries", name: "Groceries" },
    { id: "dining", name: "Dining" },
  ];

  it("creates a sorted category view model and merges unbudgeted spending", () => {
    const rows = createBudgetRows({
      budgetStatus: [
        {
          amount: 600,
          category_id: "groceries",
          id: "budget-groceries",
          remaining: 300,
          rollover: false,
          spent: 300,
        },
      ],
      categories,
      sort: "spent",
      spending: [
        { base_amount: -420, category_id: "dining", description: "Restaurant" },
        { base_amount: -30, category_id: "dining", description: "Coffee" },
        { base_amount: -15, category_id: "dining", description: "Third merchant" },
        { base_amount: -50, category_id: "groceries", description: "Market" },
      ],
      unknownCategory: "Uncategorized",
    });

    expect(rows).toEqual([
      {
        amount: 0,
        categoryId: "dining",
        id: null,
        merchants: ["Restaurant", "Coffee"],
        name: "Dining",
        remaining: -465,
        spent: 465,
      },
      {
        amount: 600,
        categoryId: "groceries",
        id: "budget-groceries",
        merchants: ["Market"],
        name: "Groceries",
        remaining: 300,
        spent: 300,
      },
    ]);
    expect(calculateBudgetSummary(rows)).toEqual({ spent: 765, totalBudget: 600 });
  });

  it("produces copy drafts and applies isolated percentage or per-category changes", () => {
    const drafts = createCopyBudgetDrafts(
      [
        {
          amount: 600,
          category_id: "groceries",
          id: "budget-groceries",
          remaining: 300,
          rollover: true,
          spent: 300,
        },
        {
          amount: null,
          category_id: "dining",
          id: "budget-dining",
          remaining: 0,
          rollover: false,
          spent: 0,
        },
      ],
      categories,
      "Uncategorized",
    );

    expect(drafts).toEqual([
      { amount: 600, categoryId: "groceries", name: "Groceries", rollover: true },
    ]);
    expect(adjustCopyBudgetDrafts(drafts, 10, Math.round)[0]?.amount).toBe(660);
    expect(replaceCopyBudgetDraftAmount(drafts, "groceries", 450)[0]?.amount).toBe(450);
    expect(adjustCopyBudgetDrafts(drafts, Number.NaN, Math.round)).toEqual(drafts);
    expect(createCopyBudgetInputs(drafts, null, "2026-08-01")).toEqual([
      {
        amount: 600,
        category_id: "groceries",
        owner_member_id: null,
        period_month: "2026-08-01",
        rollover: true,
      },
    ]);
  });

  it("encapsulates periods, transaction links, and progress rules", () => {
    expect(moveBudgetMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(getBudgetMonthEnd("2026-02-01")).toBe("2026-02-28");
    expect(getBudgetMonthLabel("2026-02-01", "en")).toContain("February");
    expect(buildBudgetTransactionsHref("dining", "2026-02-01")).toBe(
      "/transactions?categories=dining&start=2026-02-01&end=2026-02-28&type=expense",
    );
    expect(getBudgetProgress({ amount: 400, remaining: -20, spent: 420 })).toEqual({
      overBudget: true,
      percentUsed: 100,
      progress: 100,
    });
  });
});
