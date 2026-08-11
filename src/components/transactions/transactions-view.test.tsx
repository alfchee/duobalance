import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const openCreate = vi.fn();
const openEdit = vi.fn();

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/useHousehold", () => ({
  useHousehold: () => ({ baseCurrency: "USD", householdId: "household-1" }),
}));
vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: () => ({ data: [{ id: "account-1", name: "Checking" }] }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ data: [{ id: "category-1", name: "Food" }] }),
}));
vi.mock("@/hooks/useHouseholdMembers", () => ({
  useHouseholdMembers: () => ({ data: [{ display_name: "Alex", id: "member-1" }] }),
}));
vi.mock("@/hooks/useTransactions", () => ({
  useTransactions: () => ({
    data: {
      pages: [
        [
          {
            account_id: "account-1",
            amount: -12.5,
            base_amount: -12.5,
            category_id: "category-1",
            currency: "USD",
            description: "Lunch",
            id: "transaction-1",
            occurred_on: "2026-08-11",
            transfer_group_id: null,
          },
        ],
      ],
    },
    hasNextPage: false,
    isError: false,
    isLoading: false,
  }),
  useTransactionSummary: () => ({
    data: [{ amount: -12.5, base_amount: -12.5, transfer_group_id: null }],
  }),
}));
vi.mock("@/store/transactions", () => ({
  useTransactionsUiStore: (
    selector: (state: { openCreate: typeof openCreate; openEdit: typeof openEdit }) => unknown,
  ) => selector({ openCreate, openEdit }),
}));
vi.mock("@/store/accounts", () => ({
  useAccountsUiStore: (
    selector: (state: {
      openEdit: ReturnType<typeof vi.fn>;
      openManualBalance: ReturnType<typeof vi.fn>;
    }) => unknown,
  ) => selector({ openEdit: vi.fn(), openManualBalance: vi.fn() }),
}));

import { TransactionsView } from "./transactions-view";

describe("TransactionsView", () => {
  beforeEach(() => {
    replace.mockReset();
    openCreate.mockReset();
    openEdit.mockReset();
  });

  it("debounces search URL updates and preserves transaction entry actions", () => {
    vi.useFakeTimers();
    render(<TransactionsView />);

    fireEvent.change(screen.getByPlaceholderText("search"), { target: { value: "lunch" } });
    act(() => vi.advanceTimersByTime(299));
    expect(replace).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(replace).toHaveBeenCalledWith("/transactions?q=lunch");

    fireEvent.click(screen.getByRole("button", { name: "new" }));
    fireEvent.click(screen.getByRole("button", { name: "newTransfer" }));
    expect(openCreate).toHaveBeenNthCalledWith(1);
    expect(openCreate).toHaveBeenNthCalledWith(2, "transfer");
    vi.useRealTimers();
  });

  it("renders grouped transaction rows that open editing", () => {
    render(<TransactionsView />);

    fireEvent.click(screen.getByRole("button", { name: /Lunch/ }));
    expect(screen.getByText("Lunch")).toBeTruthy();
    expect(screen.getByText(/Checking · Food/)).toBeTruthy();
    expect(openEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "transaction-1" }));
  });

  it("keeps advanced filters collapsed until the user requests them", () => {
    render(<TransactionsView />);

    const toggle = screen.getByRole("button", { name: "showFilters" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByLabelText("filters.member").closest("div[hidden]")).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "hideFilters" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(screen.getByLabelText("filters.member").closest("div[hidden]")).toBeNull();
  });
});
