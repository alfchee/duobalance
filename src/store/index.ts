"use client";

import { useAccountsUiStore } from "@/store/accounts";
import { useBalancesUiStore } from "@/store/balances";
import { useBillsUiStore } from "@/store/bills";
import { useBudgetUiStore } from "@/store/budget";
import { useTransactionsUiStore } from "@/store/transactions";

const LAST_TRANSACTION_ACCOUNT_STORAGE_KEY = "duobalance:lastTransactionAccountId";

export function resetHouseholdScopedState(): void {
  useAccountsUiStore.getState().reset();
  useBalancesUiStore.getState().reset();
  useBillsUiStore.getState().reset();
  useBudgetUiStore.getState().reset();
  useTransactionsUiStore.getState().reset();
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(LAST_TRANSACTION_ACCOUNT_STORAGE_KEY);
  }
}
