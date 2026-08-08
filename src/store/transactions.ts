"use client";

import { create } from "zustand";
import type { Transaction } from "@/lib/transactions";

type TransactionsUiState = {
  formOpen: boolean;
  editingTransaction: Transaction | null;
  openCreate: () => void;
  openEdit: (transaction: Transaction) => void;
  closeForm: () => void;
};

export const useTransactionsUiStore = create<TransactionsUiState>((set) => ({
  formOpen: false,
  editingTransaction: null,
  openCreate: () => set({ formOpen: true, editingTransaction: null }),
  openEdit: (transaction) => set({ formOpen: true, editingTransaction: transaction }),
  closeForm: () => set({ formOpen: false, editingTransaction: null }),
}));
