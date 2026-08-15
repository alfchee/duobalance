import { describe, expect, it, vi } from "vitest";
import { applyActivityFilters, activitySearchTerm } from "./activity-query";
import { createFilterOperations } from "@/hooks/useTransactions";

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

  describe("createFilterOperations category filtering", () => {
    function createMockQueryBuilder() {
      const calls: { method: string; args: unknown[] }[] = [];
      const builder = {
        eq: (col: string, val: string) => {
          calls.push({ method: "eq", args: [col, val] });
          return builder;
        },
        gte: (col: string, val: string) => {
          calls.push({ method: "gte", args: [col, val] });
          return builder;
        },
        gt: (col: string, val: number) => {
          calls.push({ method: "gt", args: [col, val] });
          return builder;
        },
        in: (col: string, val: readonly string[]) => {
          calls.push({ method: "in", args: [col, val] });
          return builder;
        },
        is: (col: string, val: null) => {
          calls.push({ method: "is", args: [col, val] });
          return builder;
        },
        lte: (col: string, val: string) => {
          calls.push({ method: "lte", args: [col, val] });
          return builder;
        },
        lt: (col: string, val: number) => {
          calls.push({ method: "lt", args: [col, val] });
          return builder;
        },
        not: (col: string, op: string, val: null) => {
          calls.push({ method: "not", args: [col, op, val] });
          return builder;
        },
        or: (filters: string) => {
          calls.push({ method: "or", args: [filters] });
          return builder;
        },
      };
      return { builder, calls };
    }

    it("filters only uncategorized transactions when uncategorized is passed", () => {
      const { builder, calls } = createMockQueryBuilder();
      let query = builder;
      const ops = createFilterOperations(
        () => query,
        (next) => {
          query = next;
        },
      );

      ops.categoryIds(["uncategorized"]);
      expect(calls).toEqual([{ method: "is", args: ["category_id", null] }]);
    });

    it("filters regular category IDs when only regular IDs are passed", () => {
      const { builder, calls } = createMockQueryBuilder();
      let query = builder;
      const ops = createFilterOperations(
        () => query,
        (next) => {
          query = next;
        },
      );

      ops.categoryIds(["food", "rent"]);
      expect(calls).toEqual([{ method: "in", args: ["category_id", ["food", "rent"]] }]);
    });

    it("uses OR condition when both uncategorized and regular category IDs are passed", () => {
      const { builder, calls } = createMockQueryBuilder();
      let query = builder;
      const ops = createFilterOperations(
        () => query,
        (next) => {
          query = next;
        },
      );

      ops.categoryIds(["uncategorized", "food", "rent"]);
      expect(calls).toEqual([
        { method: "or", args: ["category_id.is.null,category_id.in.(food,rent)"] },
      ]);
    });
  });
});
