import { describe, expect, it } from "vitest";
import {
  activityRoute,
  applyActivityFilterUpdates,
  clearActivityFilterUpdates,
  hasActivityFilters,
  readActivityFilters,
  serializeActivityFilterIds,
} from "./activity-filters";

describe("activity filters", () => {
  it("reads URL filters, removes duplicate IDs, and gives account detail precedence", () => {
    const filters = readActivityFilters(
      new URLSearchParams(
        "accounts=account-1,account-1,account-2&categories=food,,rent&type=invalid&q= coffee ",
      ),
      "account-detail",
    );

    expect(filters).toEqual({
      accountIds: ["account-detail"],
      categoryIds: ["food", "rent"],
      endDate: null,
      memberId: null,
      query: " coffee ",
      startDate: null,
      type: "all",
    });
    expect(hasActivityFilters(filters)).toBe(true);
  });

  it("serializes filter updates and clears every activity key", () => {
    const next = applyActivityFilterUpdates(
      new URLSearchParams("q=coffee&type=expense&other=preserved"),
      clearActivityFilterUpdates(),
    );

    expect(next.toString()).toBe("other=preserved");
    expect(serializeActivityFilterIds(["a", "b"])).toBe("a,b");
    expect(serializeActivityFilterIds([])).toBeNull();
    expect(activityRoute(undefined, next)).toBe("/transactions?other=preserved");
    expect(activityRoute("account-1", new URLSearchParams())).toBe("/accounts/account-1");
  });
});
