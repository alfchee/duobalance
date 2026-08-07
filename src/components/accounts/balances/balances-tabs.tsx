"use client";

import { useTranslations } from "next-intl";
import { BALANCE_TABS, type BalanceTab } from "@/lib/balances";
import { useBalancesUiStore } from "@/store/balances";
import { cn } from "@/lib/utils";

// Issue #21's Mine / All / Joint tabs. Persisted via the balances store so
// the active tab survives a route change (#21 AC). Renders as a segmented
// control: equal-width buttons, the active one filled, others ghost.
export function BalancesTabs() {
  const t = useTranslations("balances");
  const tab = useBalancesUiStore((s) => s.tab);
  const setTab = useBalancesUiStore((s) => s.setTab);

  return (
    <div
      role="tablist"
      aria-label={t("tabsAriaLabel")}
      className="inline-flex w-full rounded-lg bg-muted p-1 text-sm"
    >
      {BALANCE_TABS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => setTab(id as BalanceTab)}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 font-medium transition-colors",
            tab === id
              ? "bg-background text-foreground shadow"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(`tab.${id}`)}
        </button>
      ))}
    </div>
  );
}
