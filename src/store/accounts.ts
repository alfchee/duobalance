"use client";

import { create } from "zustand";
import type { AccountWithBalance } from "@/lib/accounts";

// Ephemeral UI state only — accounts data lives in React Query (see store
// README). Which sheet/dialog is open, and whether archived accounts show.
type AccountsUiState = {
  formOpen: boolean;
  editingAccount: AccountWithBalance | null;
  manualBalanceAccount: AccountWithBalance | null;
  showArchived: boolean;
  openCreate: () => void;
  openEdit: (account: AccountWithBalance) => void;
  closeForm: () => void;
  openManualBalance: (account: AccountWithBalance) => void;
  closeManualBalance: () => void;
  setShowArchived: (show: boolean) => void;
};

export const useAccountsUiStore = create<AccountsUiState>((set) => ({
  formOpen: false,
  editingAccount: null,
  manualBalanceAccount: null,
  showArchived: false,
  openCreate: () => set({ formOpen: true, editingAccount: null }),
  openEdit: (account) => set({ formOpen: true, editingAccount: account }),
  closeForm: () => set({ formOpen: false, editingAccount: null }),
  openManualBalance: (account) => set({ manualBalanceAccount: account }),
  closeManualBalance: () => set({ manualBalanceAccount: null }),
  setShowArchived: (show) => set({ showArchived: show }),
}));
