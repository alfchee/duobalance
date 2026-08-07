"use client";

import { create } from "zustand";
import { BALANCE_TABS, isBalanceTab, type BalanceTab } from "@/lib/balances";

// The active tab is the only piece of UI state worth keeping for #21 — the
// filter, the section grouping, the freshness flags, and the FX resolution
// are all recomputed from the React Query cache. Persisted to localStorage so
// it survives navigation: the AC is "tab state survives navigation".
const STORAGE_KEY = "duobalance:balancesTab";

type BalancesUiState = {
  tab: BalanceTab;
  setTab: (tab: BalanceTab) => void;
  hydrate: () => void;
};

function readStoredTab(): BalanceTab {
  if (typeof window === "undefined") return "all";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw && isBalanceTab(raw) ? raw : "all";
}

export const useBalancesUiStore = create<BalancesUiState>((set) => ({
  tab: "all",
  setTab: (tab) => {
    set({ tab });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, tab);
    }
  },
  // Called from a client effect on mount; without it, the first paint would
  // always show "all" then jump to the saved value, which is a visible flash
  // on back-navigation to /balances.
  hydrate: () => set({ tab: readStoredTab() }),
}));

export { BALANCE_TABS };
