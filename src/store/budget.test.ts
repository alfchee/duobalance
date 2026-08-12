import { afterEach, describe, expect, it } from "vitest";
import { useBudgetUiStore } from "./budget";

function reset() {
  useBudgetUiStore.setState({ copyOpen: false, scope: "household", sort: "spent" });
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
});
