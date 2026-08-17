"use client";

import { create } from "zustand";
import type { Transaction } from "@/lib/transactions";

type TransactionsUiState = {
  formOpen: boolean;
  editingTransaction: Transaction | null;
  createMode: "transaction" | "transfer";
  openCreate: (mode?: "transaction" | "transfer") => void;
  openEdit: (transaction: Transaction) => void;
  closeForm: () => void;
  reset: () => void;
};

export const useTransactionsUiStore = create<TransactionsUiState>((set) => ({
  formOpen: false,
  editingTransaction: null,
  createMode: "transaction",
  openCreate: (mode = "transaction") =>
    set({ formOpen: true, editingTransaction: null, createMode: mode }),
  openEdit: (transaction) =>
    set({ formOpen: true, editingTransaction: transaction, createMode: "transaction" }),
  closeForm: () => set({ formOpen: false, editingTransaction: null, createMode: "transaction" }),
  reset: () => set({ formOpen: false, editingTransaction: null, createMode: "transaction" }),
}));
