import { afterEach, describe, expect, it } from "vitest";
import { useBalancesUiStore } from "./balances";

const storageKey = "duobalance:balancesTab";

function reset() {
  window.localStorage.clear();
  useBalancesUiStore.setState({ tab: "all" });
}

afterEach(reset);

describe("useBalancesUiStore", () => {
  it("persists canonical tab selections", () => {
    useBalancesUiStore.getState().setTab("mine");
    expect(useBalancesUiStore.getState().tab).toBe("mine");
    expect(window.localStorage.getItem(storageKey)).toBe("mine");
  });

  it("hydrates valid selections and rejects malformed storage", () => {
    window.localStorage.setItem(storageKey, "joint");
    useBalancesUiStore.getState().hydrate();
    expect(useBalancesUiStore.getState().tab).toBe("joint");

    window.localStorage.setItem(storageKey, "partner");
    useBalancesUiStore.getState().hydrate();
    expect(useBalancesUiStore.getState().tab).toBe("all");
  });
});
