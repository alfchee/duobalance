"use client";

import { useLocale, useTranslations } from "next-intl";
import { displayBalance, type Account } from "@/lib/accounts";
import { sumBalances, type BalanceSectionId } from "@/lib/balances";
import { useRatesByCode } from "@/hooks/useRatesByCode";
import { useHousehold } from "@/hooks/useHousehold";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { BalancesRow } from "./balances-row";

const SECTION_IDS: BalanceSectionId[] = ["cash", "credit", "savings", "loans"];

// One section of the Balances view: subtotal in the base currency plus the
// rows that fall into it. The subtotal uses the same displayBalance rule as
// the row labels (credit/loan show negative), so a positive number always
// means the household is ahead, never that the rendering is wrong.
export function BalancesSection({
  section,
  accounts,
  now,
}: {
  section: BalanceSectionId;
  accounts: Account[];
  now: Date;
}) {
  const t = useTranslations("balances");
  const locale = useLocale();
  const { baseCurrency } = useHousehold();
  const ratesByCode = useRatesByCode();

  const subtotal = baseCurrency
    ? sumBalances(accounts, baseCurrency, ratesByCode, displayBalance)
    : null;

  if (accounts.length === 0) return null;

  return (
    <section aria-label={t(`section.${section}`)} className="space-y-2">
      <header className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(`section.${section}`)}
        </h2>
        <p
          className={cn(
            "text-sm font-medium tabular-nums",
            subtotal != null && subtotal < 0 && "text-destructive",
          )}
        >
          {baseCurrency && subtotal != null ? formatMoney(subtotal, baseCurrency, locale) : "—"}
        </p>
      </header>
      <ul className="overflow-hidden rounded-lg border bg-card">
        {accounts.map((account) => (
          <BalancesRow key={account.id} account={account} now={now} />
        ))}
      </ul>
    </section>
  );
}

export const BALANCES_SECTION_IDS = SECTION_IDS;
