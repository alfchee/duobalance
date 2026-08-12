"use client";

import { create } from "zustand";

type BillsUiState = {
  editorBillId: string | null;
  editorOpen: boolean;
  payOpen: boolean;
  selectedInstanceId: string | null;
  closeEditor: () => void;
  closeInstance: () => void;
  closePay: () => void;
  reset: () => void;
  openCreate: () => void;
  openEdit: (billId: string) => void;
  openInstance: (instanceId: string) => void;
  openPay: () => void;
};

export const useBillsUiStore = create<BillsUiState>((set) => ({
  editorBillId: null,
  editorOpen: false,
  payOpen: false,
  selectedInstanceId: null,
  closeEditor: () => set({ editorBillId: null, editorOpen: false }),
  closeInstance: () => set({ selectedInstanceId: null }),
  closePay: () => set({ payOpen: false }),
  openCreate: () => set({ editorBillId: null, editorOpen: true }),
  openEdit: (editorBillId) => set({ editorBillId, editorOpen: true, selectedInstanceId: null }),
  openInstance: (selectedInstanceId) => set({ selectedInstanceId }),
  openPay: () => set({ payOpen: true }),
  reset: () =>
    set({ editorBillId: null, editorOpen: false, payOpen: false, selectedInstanceId: null }),
}));
