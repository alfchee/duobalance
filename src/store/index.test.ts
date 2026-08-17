import { beforeEach, describe, expect, it } from "vitest";
import { useAccountsUiStore } from "@/store/accounts";
import { useBalancesUiStore } from "@/store/balances";
import { useBillsUiStore } from "@/store/bills";
import { useBudgetUiStore } from "@/store/budget";
import { useTransactionsUiStore } from "@/store/transactions";
import { resetHouseholdScopedState } from "./index";

beforeEach(() => {
  window.localStorage.clear();
  resetHouseholdScopedState();
});

describe("resetHouseholdScopedState", () => {
  it("clears every household-scoped UI store and persisted balance tab", () => {
    useAccountsUiStore.getState().openCreate();
    useAccountsUiStore.getState().setShowArchived(true);
    useBalancesUiStore.getState().setTab("mine");
    useBillsUiStore.getState().openCreate();
    useBillsUiStore.getState().openPay();
    useBudgetUiStore.getState().openCreate("category-1");
    useBudgetUiStore.getState().setScope("mine");
    useTransactionsUiStore.getState().openCreate("transfer");

    resetHouseholdScopedState();

    expect(useAccountsUiStore.getState()).toMatchObject({ formOpen: false, showArchived: false });
    expect(useBalancesUiStore.getState().tab).toBe("all");
    expect(window.localStorage.getItem("duobalance:balancesTab")).toBeNull();
    expect(useBillsUiStore.getState()).toMatchObject({ editorOpen: false, payOpen: false });
    expect(useBudgetUiStore.getState()).toMatchObject({ editorOpen: false, scope: "household" });
    expect(useTransactionsUiStore.getState()).toMatchObject({
      formOpen: false,
      createMode: "transaction",
    });
  });
});
