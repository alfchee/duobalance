"use client";

import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { BillingGate } from "@/components/billing/billing-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdPlan, usePlanCatalogue, UNLIMITED_LIMIT } from "@/hooks/useEntitlement";

// Plan comparison screen (issue #264, epic #255).
//
// Driven by the plans/plan_features tables: what a plan includes is a data
// change in the database, not copy in a deploy. Only the feature-key labels
// are locale data (ADR 0001: codes are stable, display names are locale
// data). Hidden entirely while billing is off via BillingGate (#262).

// Internal enforcement vocabulary, not a sellable feature: both plans grant
// it identically (migration 20260923063231) and showing it would only
// confuse the comparison.
const HIDDEN_FEATURES = new Set(["write_access"]);

export function PlanSection() {
  return (
    <BillingGate>
      <PlanComparison />
    </BillingGate>
  );
}

function PlanComparison() {
  const t = useTranslations("settings.plan");
  const locale = useLocale();
  const { householdId } = useHousehold();
  const catalogue = usePlanCatalogue();
  const householdPlan = useHouseholdPlan(householdId);

  const plans = catalogue.data ?? [];
  // Rows are the union of feature keys across shown plans, in stable
  // alphabetical order, minus the internal enforcement vocabulary.
  const featureKeys = [...new Set(plans.flatMap((plan) => Object.keys(plan.features)))]
    .filter((key) => !HIDDEN_FEATURES.has(key))
    .sort();

  if (catalogue.isPending) {
    return (
      <section id="plan" className="overflow-hidden rounded-2xl border bg-card shadow-ring">
        <h2 className="border-b bg-secondary px-4 py-3 text-sm font-semibold">{t("title")}</h2>
        <div className="space-y-2 px-4 py-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      </section>
    );
  }

  if (catalogue.isError || plans.length === 0) {
    return (
      <section id="plan" className="overflow-hidden rounded-2xl border bg-card shadow-ring">
        <h2 className="border-b bg-secondary px-4 py-3 text-sm font-semibold">{t("title")}</h2>
        <p role="alert" className="px-4 py-4 text-sm text-destructive">
          {t("error")}
        </p>
      </section>
    );
  }

  return (
    <section id="plan" className="overflow-hidden rounded-2xl border bg-card shadow-ring">
      <h2 className="border-b bg-secondary px-4 py-3 text-sm font-semibold">{t("title")}</h2>
      <p className="px-4 py-3 text-sm text-muted-foreground">{t("subtitle")}</p>
      <div className="overflow-x-auto px-4 pb-4">
        <table className="w-full min-w-80 border-collapse text-sm">
          <caption className="sr-only">{t("title")}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-1/3 text-left font-medium" />
              {plans.map((plan) => (
                <th
                  key={plan.code}
                  scope="col"
                  className="px-2 py-2 text-left align-bottom font-semibold"
                >
                  {plan.name}
                  {householdPlan.data === plan.code ? (
                    <Badge variant="secondary" className="ml-2 align-middle">
                      {t("currentPlanBadge")}
                    </Badge>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {featureKeys.map((key) => (
              <tr key={key} className="border-t">
                <th scope="row" className="py-2 text-left align-top font-normal">
                  {t(`features.${key}`)}
                </th>
                {plans.map((plan) => {
                  const value = plan.features[key];
                  return (
                    <td key={plan.code} className="px-2 py-2 align-top">
                      {formatFeatureValue(value, t, key, locale)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type FeatureMessages = ReturnType<typeof useTranslations>;

function formatFeatureValue(
  value: { enabled: boolean; limit: number | null } | undefined,
  t: FeatureMessages,
  key: string,
  locale: string,
): string {
  if (!value || !value.enabled) return t("notIncluded");
  // NULL limit is explicitly unlimited (ADR 0001); a number is a count.
  if (value.limit === null || value.limit >= UNLIMITED_LIMIT) {
    return key === "history_days" ? t("unlimitedHistory") : t("unlimited");
  }
  const fmt = new Intl.NumberFormat(locale);
  return key === "history_days"
    ? t("days", { count: fmt.format(value.limit) })
    : fmt.format(value.limit);
}
