"use client";

import { create } from "zustand";
import type { BudgetScope, BudgetSort } from "@/lib/budgets/model";

type BudgetUiState = {
  copyOpen: boolean;
  createCategoryId: string | null;
  editingBudgetId: string | null;
  editorOpen: boolean;
  deleteBudgetId: string | null;
  scope: BudgetScope;
  sort: BudgetSort;
  setCopyOpen: (copyOpen: boolean) => void;
  openCreate: (categoryId?: string | null) => void;
  openEdit: (budgetId: string) => void;
  closeEditor: () => void;
  requestDelete: (budgetId: string | null) => void;
  setScope: (scope: BudgetScope) => void;
  setSort: (sort: BudgetSort) => void;
};

export const useBudgetUiStore = create<BudgetUiState>((set) => ({
  copyOpen: false,
  createCategoryId: null,
  deleteBudgetId: null,
  editingBudgetId: null,
  editorOpen: false,
  scope: "household",
  setCopyOpen: (copyOpen) => set({ copyOpen }),
  openCreate: (createCategoryId = null) =>
    set({ createCategoryId, editingBudgetId: null, editorOpen: true }),
  openEdit: (editingBudgetId) => set({ createCategoryId: null, editingBudgetId, editorOpen: true }),
  closeEditor: () => set({ createCategoryId: null, editingBudgetId: null, editorOpen: false }),
  requestDelete: (deleteBudgetId) => set({ deleteBudgetId }),
  setScope: (scope) => set({ scope }),
  setSort: (sort) => set({ sort }),
  sort: "spent",
}));
