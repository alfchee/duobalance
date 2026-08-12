import { describe, expect, it, vi } from "vitest";
import { applyActivityFilters, activitySearchTerm } from "./activity-query";

describe("activity query", () => {
  it("normalizes search input and delegates only active filters to its port", () => {
    const operations = {
      accountIds: vi.fn(),
      categoryIds: vi.fn(),
      endDate: vi.fn(),
      expense: vi.fn(),
      income: vi.fn(),
      memberId: vi.fn(),
      search: vi.fn(),
      startDate: vi.fn(),
      transfer: vi.fn(),
    };

    applyActivityFilters(
      {
        accountIds: ["account-1"],
        categoryIds: ["food"],
        endDate: "2026-08-31",
        memberId: "member-1",
        query: " (coffee, tea) ",
        startDate: "2026-08-01",
        type: "expense",
      },
      operations,
    );

    expect(operations.accountIds).toHaveBeenCalledWith(["account-1"]);
    expect(operations.categoryIds).toHaveBeenCalledWith(["food"]);
    expect(operations.startDate).toHaveBeenCalledWith("2026-08-01");
    expect(operations.endDate).toHaveBeenCalledWith("2026-08-31");
    expect(operations.memberId).toHaveBeenCalledWith("member-1");
    expect(operations.expense).toHaveBeenCalledOnce();
    expect(operations.search).toHaveBeenCalledWith(" coffee  tea ");
    expect(operations.income).not.toHaveBeenCalled();
    expect(operations.transfer).not.toHaveBeenCalled();
    expect(activitySearchTerm("  ")).toBe("");
  });

  it("supports each transaction-type extension without requiring unrelated operations", () => {
    const operations = {
      accountIds: vi.fn(),
      categoryIds: vi.fn(),
      endDate: vi.fn(),
      expense: vi.fn(),
      income: vi.fn(),
      memberId: vi.fn(),
      search: vi.fn(),
      startDate: vi.fn(),
      transfer: vi.fn(),
    };
    const filters = {
      accountIds: [],
      categoryIds: [],
      endDate: null,
      memberId: null,
      query: "",
      startDate: null,
    } as const;

    applyActivityFilters({ ...filters, type: "income" }, operations);
    applyActivityFilters({ ...filters, type: "transfer" }, operations);
    applyActivityFilters({ ...filters, type: "all" }, operations);

    expect(operations.income).toHaveBeenCalledOnce();
    expect(operations.transfer).toHaveBeenCalledOnce();
    expect(operations.expense).not.toHaveBeenCalled();
    expect(operations.search).not.toHaveBeenCalled();
  });
});
