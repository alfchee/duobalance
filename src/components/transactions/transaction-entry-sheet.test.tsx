import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const closeForm = vi.fn();
const remove = { isPending: false, mutateAsync: vi.fn() };

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));
vi.mock("@/hooks/useHousehold", () => ({
  useHousehold: () => ({
    baseCurrency: "USD",
    householdId: "household-1",
    memberId: "member-1",
    timezone: "UTC",
  }),
}));
vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: () => ({
    data: [{ currency: "USD", id: "account-1", is_archived: false, name: "Checking" }],
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ data: [] }),
  useCategorizationRules: () => ({ data: [] }),
}));
vi.mock("@/hooks/useCurrencies", () => ({
  useCurrencies: () => ({ data: [{ code: "USD", minor_unit: 2 }] }),
}));
vi.mock("@/hooks/useFxOverrides", () => ({ useFxOverrides: () => ({ data: [] }) }));
vi.mock("@/hooks/useHouseholdMembers", () => ({ useHouseholdMembers: () => ({ data: [] }) }));
vi.mock("@/hooks/useOnboardingProgress", () => ({
  useOnboardingProgress: () => ({ hasTransactions: true }),
}));
vi.mock("@/hooks/useTransactions", () => ({
  useFxRateOn: () => ({ data: null }),
  useTransactionDescriptions: () => ({ data: [] }),
  useTransactionMutations: () => ({
    create: { isPending: false, mutateAsync: vi.fn() },
    createTransfer: { isPending: false, mutateAsync: vi.fn() },
    remove,
    update: { isPending: false, mutateAsync: vi.fn() },
  }),
}));
vi.mock("@/components/realtime-status", () => ({
  useOfflineQueue: () => ({ connectionState: "online", queueTransaction: vi.fn() }),
}));
vi.mock("@/store/transactions", () => ({
  useTransactionsUiStore: () => ({
    closeForm,
    createMode: "transaction",
    editingTransaction: {
      account_id: "account-1",
      amount: -25,
      category_id: null,
      currency: "USD",
      description: "Transfer to savings",
      fx_rate: 1,
      id: "transaction-1",
      notes: null,
      occurred_on: "2026-08-11",
      spent_by: null,
      transfer_group_id: "transfer-1",
    },
    formOpen: true,
  }),
}));

import { TransactionEntrySheet } from "./transaction-entry-sheet";

describe("TransactionEntrySheet", () => {
  beforeEach(() => {
    remove.mutateAsync.mockReset();
    closeForm.mockReset();
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
  });

  it("presents an existing transfer as delete-only instead of an editable transaction", () => {
    render(<TransactionEntrySheet />);

    expect(screen.getByText("form.errors.transferReadOnly")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "form.save" })).toBeNull();
    expect(screen.getByText("−$25.00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "form.delete" }));
    expect(window.confirm).toHaveBeenCalledWith("form.confirmDelete");
    expect(remove.mutateAsync).toHaveBeenCalledWith("transaction-1");
  });
});
