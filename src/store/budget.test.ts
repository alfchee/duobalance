import { afterEach, describe, expect, it } from "vitest";
import { useBudgetUiStore } from "./budget";

function reset() {
  useBudgetUiStore.setState({
    copyOpen: false,
    createCategoryId: null,
    scope: "household",
    sort: "spent",
  });
}

afterEach(reset);

describe("useBudgetUiStore", () => {
  it("owns only ephemeral budget controls", () => {
    const state = useBudgetUiStore.getState();

    state.setScope("mine");
    state.setSort("name");
    state.setCopyOpen(true);

    expect(useBudgetUiStore.getState()).toMatchObject({
      copyOpen: true,
      scope: "mine",
      sort: "name",
    });
  });

  it("preselects a category for a row-level create action", () => {
    useBudgetUiStore.getState().openCreate("category-1");

    expect(useBudgetUiStore.getState()).toMatchObject({
      createCategoryId: "category-1",
      editingBudgetId: null,
      editorOpen: true,
    });
  });
});
