import { describe, expect, it } from "vitest";
import { ilikePatternToRegExp, matchCategory, matchesIlike } from "./categories";
import type { CategorizationRule } from "./categories";

function rule(overrides: Partial<CategorizationRule>): CategorizationRule {
  return {
    account_id: null,
    category_id: "category-default",
    created_at: "2026-01-01T00:00:00.000Z",
    household_id: "household",
    id: "rule-default",
    is_active: true,
    match_pattern: "%",
    priority: 100,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("matchCategory", () => {
  it("uses the lowest priority matching active rule", () => {
    expect(
      matchCategory("Uber Eats", [
        rule({ id: "later", category_id: "restaurants", match_pattern: "%uber%", priority: 20 }),
        rule({ id: "first", category_id: "transport", match_pattern: "%uber%", priority: 10 }),
      ]),
    ).toBe("transport");
  });

  it("breaks equal priorities deterministically by id", () => {
    expect(
      matchCategory("Netflix", [
        rule({ id: "b-rule", category_id: "other", match_pattern: "%netflix%", priority: 10 }),
        rule({
          id: "a-rule",
          category_id: "entertainment",
          match_pattern: "%netflix%",
          priority: 10,
        }),
      ]),
    ).toBe("entertainment");
  });

  it("supports ILIKE percent and underscore wildcards", () => {
    expect(matchesIlike("UBER EATS", "%uber%")).toBe(true);
    expect(matchesIlike("NETFLIX", "net_li%")).toBe(true);
  });

  it("returns null when no active rule matches", () => {
    expect(
      matchCategory("Groceries", [rule({ is_active: false, match_pattern: "%grocer%" })]),
    ).toBeNull();
  });

  it("escapes regular expression metacharacters", () => {
    expect(ilikePatternToRegExp("%a.b*c%").test("a.b*c")).toBe(true);
    expect(ilikePatternToRegExp("%a.b*c%").test("axbZZc")).toBe(false);
  });
});
