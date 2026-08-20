"use client";

import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useBalancesScreen } from "@/hooks/useBalancesScreen";
import { EmptyAccounts } from "@/components/accounts/empty-state";
import { GettingStartedChecklist } from "@/components/household/getting-started-checklist";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAccountsUiStore } from "@/store/accounts";
import { BalancesSection } from "./balances-section";
import { BalancesTabs } from "./balances-tabs";
import { BalancesHeader } from "./balances-header";

// Honeydue-style Balances screen (#21). Three tabs (Mine / All / Joint) on top
// of the household net worth; each section is a kind bucket with a subtotal;
// every row shows its freshness. Tab state is persisted via the store so it
// survives back-navigation.
export function BalancesView() {
  const t = useTranslations("balances");
  const { openCreate } = useAccountsUiStore();
  const {
    accounts,
    baseCurrency,
    hasAccounts,
    isError,
    isLoading,
    model,
    now,
    reorderSection,
    retry,
    today,
  } = useBalancesScreen();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GettingStartedChecklist />
      {hasAccounts ? (
        <>
          <BalancesHeader
            accounts={accounts}
            baseRateDate={model.baseRateDate}
            breakdown={model.breakdown}
            netWorth={model.netWorth}
          />
          <BalancesTabs />
          {model.visibleAccounts.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              {t("tabEmpty")}
            </div>
          ) : (
            <div className="space-y-4">
              {model.visibleSectionIds.map((id) => (
                <BalancesSection
                  key={id}
                  section={id}
                  accounts={model.groupedAccounts[id]}
                  baseCurrency={baseCurrency}
                  now={now}
                  subtotal={model.sectionTotals[id]}
                  onReorder={reorderSection}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <EmptyAccounts />
      )}

      <div className="flex flex-col items-center gap-3 text-center">
        {hasAccounts && today ? (
          <p className="px-1 text-[11px] text-muted-foreground">
            {t("computedOn", { date: today })}
          </p>
        ) : null}
        <Button type="button" onClick={openCreate}>
          <Plus />
          {t("newAccount")}
        </Button>
      </div>
    </div>
  );
}
