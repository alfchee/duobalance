import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BudgetCategoryList } from "./budget-category-list";

const row = {
  amount: 1_000,
  categoryId: "category-1",
  id: "budget-1",
  merchants: ["Market", "Bakery"],
  name: "Household essentials and groceries",
  remaining: 250,
  rollover: false,
  spent: 750,
};

describe("BudgetCategoryList", () => {
  it("renders the budget name, amount, details, progress, and actions in reading order", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <BudgetCategoryList
        actions={{ create: "Create", delete: "Delete", edit: "Edit" }}
        currency="USD"
        locale="en"
        numberFormat="locale"
        onCreate={vi.fn()}
        onDelete={onDelete}
        onEdit={onEdit}
        periodMonth="2026-08-01"
        rows={[row]}
        translations={{
          categories: "Categories",
          noBudget: "No budget",
          overBy: ({ amount }) => `${amount} over`,
          percentUsed: ({ percent }) => `${percent}% used`,
          visibleToYou: "Visible to you",
        }}
        visibleToHousehold
      />,
    );

    const item = screen.getByRole("listitem");
    const text = item.textContent ?? "";
    expect(text.indexOf(row.name)).toBeLessThan(text.indexOf("$750.00"));
    expect(text.indexOf("$750.00")).toBeLessThan(text.indexOf("Market · Bakery"));
    expect(text.indexOf("Market · Bakery")).toBeLessThan(text.indexOf("75% used"));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onEdit).toHaveBeenCalledWith("budget-1");
    expect(onDelete).toHaveBeenCalledWith("budget-1");
  });
});
