"use client";

import { useAccountsUiStore } from "@/store/accounts";
import { useBalancesUiStore } from "@/store/balances";
import { useBillsUiStore } from "@/store/bills";
import { useBudgetUiStore } from "@/store/budget";
import { useTransactionsUiStore } from "@/store/transactions";

export function resetHouseholdScopedState(): void {
  useAccountsUiStore.getState().reset();
  useBalancesUiStore.getState().reset();
  useBillsUiStore.getState().reset();
  useBudgetUiStore.getState().reset();
  useTransactionsUiStore.getState().reset();
}
