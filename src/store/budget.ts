"use client";

import { create } from "zustand";
import type { BudgetScope, BudgetSort } from "@/lib/budgets/model";

type BudgetUiState = {
  copyOpen: boolean;
  scope: BudgetScope;
  sort: BudgetSort;
  setCopyOpen: (copyOpen: boolean) => void;
  setScope: (scope: BudgetScope) => void;
  setSort: (sort: BudgetSort) => void;
};

export const useBudgetUiStore = create<BudgetUiState>((set) => ({
  copyOpen: false,
  scope: "household",
  setCopyOpen: (copyOpen) => set({ copyOpen }),
  setScope: (scope) => set({ scope }),
  setSort: (sort) => set({ sort }),
  sort: "spent",
}));
