import { describe, expect, it } from "vitest";
import {
  categoryTree,
  ilikePatternToRegExp,
  matchCategory,
  matchesIlike,
  matchingRule,
} from "./categories";
import type { CategorizationRule } from "./categories";
import type { Category } from "./categories";

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

  it("supports ILIKE backslash escapes for wildcard and escape characters", () => {
    expect(matchesIlike("Discount 50%", "%50\\%%")).toBe(true);
    expect(matchesIlike("Discount 500", "%50\\%%")).toBe(false);
    expect(matchesIlike("file_name", "file\\_name")).toBe(true);
    expect(matchesIlike("filename", "file\\_name")).toBe(false);
    expect(matchesIlike("C:\\Users", "C:\\\\Users")).toBe(true);
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

describe("matchingRule", () => {
  it("returns the full deterministic winning rule", () => {
    const winner = rule({ id: "a-rule", category_id: "entertainment", match_pattern: "%netflix%" });
    expect(
      matchingRule("Netflix", [
        rule({ id: "b-rule", category_id: "other", match_pattern: "%netflix%" }),
        winner,
        rule({ id: "inactive", is_active: false, match_pattern: "%netflix%", priority: 1 }),
      ]),
    ).toEqual(winner);
  });

  it("returns null without an active matching rule", () => {
    expect(
      matchingRule("Groceries", [rule({ is_active: false, match_pattern: "%grocer%" })]),
    ).toBeNull();
  });
});

function category(overrides: Partial<Category>): Category {
  return {
    color_hex: null,
    created_at: "2026-01-01T00:00:00.000Z",
    display_order: 0,
    household_id: "household",
    icon: null,
    id: "category-default",
    is_archived: false,
    is_default: false,
    kind: "expense",
    name: "Default",
    parent_id: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("categoryTree", () => {
  it("includes active roots and their immediate children in input order", () => {
    const food = category({ id: "food", name: "Food" });
    const dining = category({ id: "dining", name: "Dining", parent_id: "food" });
    expect(
      categoryTree(
        [
          food,
          dining,
          category({ id: "income", kind: "income" }),
          category({ id: "old", is_archived: true }),
        ],
        "expense",
      ),
    ).toEqual([food, dining]);
  });
});
