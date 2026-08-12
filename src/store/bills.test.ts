import { beforeEach, describe, expect, it } from "vitest";
import { useBillsUiStore } from "./bills";

describe("bills UI store", () => {
  beforeEach(() => {
    const store = useBillsUiStore.getState();
    store.closeEditor();
    store.closeInstance();
    store.closePay();
  });

  it("keeps sheet state as identifiers rather than server records", () => {
    const store = useBillsUiStore.getState();
    store.openEdit("bill-1");
    store.openInstance("instance-1");
    expect(useBillsUiStore.getState()).toMatchObject({
      editorBillId: "bill-1",
      editorOpen: true,
      selectedInstanceId: "instance-1",
    });
  });

  it("opens and closes create and payment sheets independently", () => {
    const store = useBillsUiStore.getState();
    store.openCreate();
    store.openPay();
    expect(useBillsUiStore.getState()).toMatchObject({
      editorBillId: null,
      editorOpen: true,
      payOpen: true,
    });
    useBillsUiStore.getState().closeEditor();
    useBillsUiStore.getState().closePay();
    expect(useBillsUiStore.getState()).toMatchObject({ editorOpen: false, payOpen: false });
  });
});
