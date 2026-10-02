"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { effectiveEntitlement, shouldBypassPlanGating } from "@/lib/billing/enabled";

// Plan gating in the UI (issue #264, epic #255).
//
// Client half of entitlement: presents what the database already enforces
// (RLS policies from #261 and the feature_limit trigger), never decides it.
// Every call goes through the fail-open rule of #262 — with the billing
// exposure flag off, `effectiveEntitlement()` returns true and
// `shouldBypassPlanGating()` skips the queries entirely, so no gate renders
// and no counted feature ever shows an approach warning.

// feature_limit() coalesces a NULL limit_value (explicitly unlimited) to
// Int32 max. A MISSING plan_features row returns 0 — never unlimited.
export const UNLIMITED_LIMIT = 2147483647;

export type Entitlement = {
  /** Effective entitlement (fail-open while billing is off). */
  entitled: boolean;
  /** Raw feature_limit() value. Meaningless when `unlimited` is true. */
  limit: number;
  /** True when the plan marks the feature explicitly unlimited. */
  unlimited: boolean;
  /** True until the entitlement is resolved (or resolved by bypass). */
  pending: boolean;
};

const RESOLVED_FALSE: Entitlement = {
  entitled: false,
  limit: UNLIMITED_LIMIT,
  unlimited: true,
  pending: true,
};

export function useEntitlement(householdId: string | null, feature: string): Entitlement {
  const bypass = shouldBypassPlanGating();

  const query = useQuery({
    queryKey: ["entitlement", householdId, feature],
    enabled: !bypass && !!householdId,
    queryFn: async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase) throw new Error("supabase not configured");
      const [hasFeature, featureLimit] = await Promise.all([
        supabase.rpc("has_feature", { p_household: householdId!, p_feature: feature }),
        supabase.rpc("feature_limit", { p_household: householdId!, p_feature: feature }),
      ]);
      if (hasFeature.error) throw hasFeature.error;
      if (featureLimit.error) throw featureLimit.error;
      return {
        entitled: Boolean(hasFeature.data),
        limit: Number(featureLimit.data ?? 0),
      };
    },
  });

  // #262 fail-open rule: while the flag is off everyone is entitled, and
  // counted features must behave as unlimited so no limit indicator shows.
  if (bypass) return { entitled: true, limit: UNLIMITED_LIMIT, unlimited: true, pending: false };

  // DB-side default is fail-closed, but a transient error revealing or
  // hiding a feature is the #262 trade-off: hiding a paid feature from a
  // paying user is the worse failure, so errors resolve as entitled with
  // no limit shown.
  if (query.isError)
    return { entitled: true, limit: UNLIMITED_LIMIT, unlimited: true, pending: false };

  if (query.isPending || !query.data) return RESOLVED_FALSE;

  const { entitled, limit } = query.data;
  return {
    entitled: effectiveEntitlement(entitled),
    limit,
    unlimited: limit >= UNLIMITED_LIMIT,
    pending: false,
  };
}

export type PlanFeatureValue = { enabled: boolean; limit: number | null };

export type PlanCatalogueEntry = {
  code: string;
  name: string;
  isPublic: boolean;
  /** feature_key → { enabled, limit }. NULL limit = explicitly unlimited. */
  features: Record<string, PlanFeatureValue>;
};

// The comparison screen reads the catalogue, so changing what a plan
// includes is a data change (plans/plan_features rows) with no deploy —
// plan names come from the plans table, limits from plan_features. Only
// the locale labels for feature keys live in src/messages.
//
// Non-public plans (e.g. `comped`, 20260924012145) are fetched too but the
// caller decides visibility: a household's current plan must appear so the
// "your plan" badge resolves, while a non-public plan nobody is on stays
// hidden from the sellable comparison.
export function usePlanCatalogue() {
  return useQuery({
    queryKey: ["plan-catalogue"],
    queryFn: async (): Promise<PlanCatalogueEntry[]> => {
      const supabase = createSupabaseBrowser();
      if (!supabase) throw new Error("supabase not configured");
      const [plans, planFeatures] = await Promise.all([
        supabase
          .from("plans")
          .select("code, name, is_public, sort_order")
          .order("sort_order")
          .order("code"),
        supabase.from("plan_features").select("plan_code, feature_key, enabled, limit_value"),
      ]);
      if (plans.error) throw plans.error;
      if (planFeatures.error) throw planFeatures.error;
      return (plans.data ?? []).map((plan) => ({
        code: plan.code,
        name: plan.name,
        isPublic: plan.is_public,
        features: Object.fromEntries(
          (planFeatures.data ?? [])
            .filter((row) => row.plan_code === plan.code)
            .map((row) => [
              row.feature_key,
              { enabled: row.enabled, limit: row.limit_value ?? null },
            ]),
        ),
      }));
    },
  });
}

// Which plan the household currently resolves to (household_plan() applies
// the same live-status window as the RLS helpers). Used to badge "your
// plan" on the comparison screen.
export function useHouseholdPlan(householdId: string | null) {
  return useQuery({
    queryKey: ["household-plan", householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<string | null> => {
      const supabase = createSupabaseBrowser();
      if (!supabase) throw new Error("supabase not configured");
      const { data, error } = await supabase.rpc("household_plan", {
        p_household: householdId!,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });
}
