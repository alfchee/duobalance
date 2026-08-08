import type { Database } from "@/lib/supabase/types";

type CategoriesTable = Database["public"]["Tables"]["categories"];
type CategorizationRulesTable = Database["public"]["Tables"]["categorization_rules"];

export type Category = CategoriesTable["Row"];
export type CategoryInsert = CategoriesTable["Insert"];
export type CategoryUpdate = CategoriesTable["Update"];
export type CategorizationRule = CategorizationRulesTable["Row"];
export type CategorizationRuleInsert = CategorizationRulesTable["Insert"];
export type CategorizationRuleUpdate = CategorizationRulesTable["Update"];
export type CategoryKind = "expense" | "income";

export function ilikePatternToRegExp(pattern: string): RegExp {
  let source = "^";
  for (const character of pattern) {
    if (character === "%") {
      source += ".*";
    } else if (character === "_") {
      source += ".";
    } else {
      source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`, "i");
}

export function matchesIlike(value: string, pattern: string): boolean {
  return ilikePatternToRegExp(pattern).test(value);
}

export function matchCategory(
  description: string,
  rules: readonly CategorizationRule[],
): string | null {
  return (
    rules
      .filter((rule) => rule.is_active)
      .toSorted((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
      .find((rule) => matchesIlike(description, rule.match_pattern))?.category_id ?? null
  );
}

export function matchingRule(
  description: string,
  rules: readonly CategorizationRule[],
): CategorizationRule | null {
  return (
    rules
      .filter((rule) => rule.is_active)
      .toSorted((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
      .find((rule) => matchesIlike(description, rule.match_pattern)) ?? null
  );
}

export function categoryTree(categories: readonly Category[], kind: CategoryKind): Category[] {
  const matching = categories.filter((category) => category.kind === kind && !category.is_archived);
  const roots = matching.filter((category) => category.parent_id === null);
  const children = matching.filter((category) => category.parent_id !== null);
  return roots.flatMap((root) => [
    root,
    ...children.filter((child) => child.parent_id === root.id),
  ]);
}
