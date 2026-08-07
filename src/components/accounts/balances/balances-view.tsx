"use client";

import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useAccounts } from "@/hooks/useAccounts";
import { useHousehold } from "@/hooks/useHousehold";
import { useFxOverrides } from "@/hooks/useFxOverrides";
import { EmptyAccounts } from "@/components/accounts/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { filterByTab, groupBySection, type BalanceSectionId } from "@/lib/balances";
import { useBalancesUiStore } from "@/store/balances";
import { useAccountsUiStore } from "@/store/accounts";
import { BALANCES_SECTION_IDS, BalancesSection } from "./balances-section";
import { BalancesTabs } from "./balances-tabs";
import { BalancesHeader } from "./balances-header";
import { todayInHousehold } from "@/lib/dates";

// Honeydue-style Balances screen (#21). Three tabs (Mine / All / Joint) on top
// of the household net worth; each section is a kind bucket with a subtotal;
// every row shows its freshness. Tab state is persisted via the store so it
// survives back-navigation.
export function BalancesView() {
  const t = useTranslations("balances");
  const { householdId, memberId, timezone } = useHousehold();
  const { data: accounts, isLoading, isError, refetch } = useAccounts(householdId);
  const { isLoading: ratesLoading } = useFxOverrides();
  const tab = useBalancesUiStore((s) => s.tab);
  const hydrate = useBalancesUiStore((s) => s.hydrate);
  const { openCreate } = useAccountsUiStore();

  // Hydrate the tab from localStorage on mount. The store's default is "all";
  // without this, the first paint always flashes to "all" before jumping to
  // the saved value on a back-navigation.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Use a stable "now" so the relative-time strings don't refresh every render
  // and cause hydration mismatches. The household timezone keeps "Updated 0d
  // ago" / "Updated 1d ago" honest across day boundaries for the user.
  const now = useMemo(() => new Date(), []);
  const today = timezone ? todayInHousehold(timezone, now) : null;

  const visible = useMemo(
    () => (accounts ? filterByTab(accounts, tab, memberId) : []),
    [accounts, tab, memberId],
  );
  const grouped = useMemo(() => groupBySection(visible), [visible]);
  const visibleSectionIds: BalanceSectionId[] = BALANCES_SECTION_IDS.filter(
    (id) => grouped[id].length > 0,
  );

  if (isLoading || ratesLoading) {
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
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  const hasAccounts = (accounts?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      {hasAccounts ? (
        <>
          <BalancesHeader accounts={accounts ?? []} />
          <BalancesTabs />
          {visible.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              {t("tabEmpty")}
            </div>
          ) : (
            <div className="space-y-4">
              {visibleSectionIds.map((id) => (
                <BalancesSection key={id} section={id} accounts={grouped[id]} now={now} />
              ))}
            </div>
          )}
          {today ? (
            <p className="px-1 text-[11px] text-muted-foreground">
              {t("computedOn", { date: today })}
            </p>
          ) : null}
        </>
      ) : (
        <EmptyAccounts />
      )}

      <div className="flex justify-end">
        <Button type="button" onClick={openCreate}>
          <Plus />
          {t("newAccount")}
        </Button>
      </div>
    </div>
  );
}
