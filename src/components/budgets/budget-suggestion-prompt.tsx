"use client";

import { useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useHousehold } from "@/hooks/useHousehold";
import { useBudgetSuggestion } from "@/hooks/useBudgetSuggestion";
import { useCurrencies } from "@/hooks/useCurrencies";
import { formatMoney } from "@/lib/money";
import { startOfMonthInHousehold } from "@/lib/dates";
import { useBudgetUiStore } from "@/store/budget";
import { BudgetSuggestionDialog } from "./budget-suggestion-dialog";

type Props = {
  periodMonth: string;
};

export function BudgetSuggestionPrompt({ periodMonth }: Props) {
  const t = useTranslations("budget.suggestion");
  const locale = useLocale();
  const { householdId, baseCurrency, numberFormat, timezone, memberId } = useHousehold();
  const { data: currencies = [] } = useCurrencies();
  const scope = useBudgetUiStore((s) => s.scope);
  const ownerMemberId = scope === "mine" ? memberId : null;

  const suggestion = useBudgetSuggestion(householdId, ownerMemberId, periodMonth);
  const currency = baseCurrency ?? "USD";
  const [dialogOpen, setDialogOpen] = useState(false);

  if (suggestion.isLoading || !suggestion.eligible) return null;

  const effectivePeriodMonth = periodMonth ?? startOfMonthInHousehold(timezone ?? "UTC");

  return (
    <>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-amber-500 text-white">
              <Lightbulb className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-black tracking-tight">{t("title")}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t("description", { count: suggestion.transactionCount })}
              </p>
              <p className="mt-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                {t("derivedLabel")}
              </p>
              <ul className="mt-2 grid gap-1.5">
                {suggestion.suggestions.slice(0, 5).map((s) => (
                  <li
                    key={s.categoryId}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="tabular-nums font-semibold">
                      {formatMoney(s.suggestedAmount, currency, locale, numberFormat)}
                    </span>
                  </li>
                ))}
                {suggestion.suggestions.length > 5 ? (
                  <li className="text-xs text-muted-foreground">
                    {t("moreCategories", { count: suggestion.suggestions.length - 5 })}
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={suggestion.dismiss}
            aria-label={t("dismiss")}
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button type="button" className="rounded-full" onClick={() => setDialogOpen(true)}>
            {t("cta")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="rounded-full"
            onClick={suggestion.dismiss}
          >
            {t("dismiss")}
          </Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("hint")}</p>
      </div>

      <BudgetSuggestionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        suggestions={suggestion.suggestions}
        currency={currency}
        locale={locale}
        numberFormat={numberFormat}
        minorUnit={currencies.find((c) => c.code === baseCurrency)?.minor_unit ?? 2}
        periodMonth={effectivePeriodMonth}
        ownerMemberId={ownerMemberId}
        onCreated={() => setDialogOpen(false)}
      />
    </>
  );
}
