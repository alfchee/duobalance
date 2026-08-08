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
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === undefined) continue;
    if (character === "\\") {
      const nextCharacter = pattern[index + 1];
      if (nextCharacter !== undefined) {
        source += nextCharacter.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
        index += 1;
      } else {
        source += "\\\\";
      }
    } else if (character === "%") {
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
  const childrenByParent = new Map<string, Category[]>();
  for (const category of matching) {
    if (category.parent_id === null) continue;
    const children = childrenByParent.get(category.parent_id);
    if (children) children.push(category);
    else childrenByParent.set(category.parent_id, [category]);
  }
  return roots.flatMap((root) => [root, ...(childrenByParent.get(root.id) ?? [])]);
}
