"use client";

import Link from "next/link";
import type { BudgetRow } from "@/lib/budgets/model";
import { buildBudgetTransactionsHref, getBudgetProgress } from "@/lib/budgets/model";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type BudgetCategoryListProps = {
  currency: string;
  locale: string;
  periodMonth: string;
  rows: readonly BudgetRow[];
  translations: {
    categories: string;
    noBudget: string;
    overBy: (values: { amount: string }) => string;
    percentUsed: (values: { percent: number }) => string;
    visibleToYou: string;
  };
  visibleToHousehold: boolean;
};

export function BudgetCategoryList({
  currency,
  locale,
  periodMonth,
  rows,
  translations,
  visibleToHousehold,
}: BudgetCategoryListProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end justify-between border-b pb-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {translations.categories}
        </p>
        {visibleToHousehold ? (
          <p className="text-xs text-muted-foreground">{translations.visibleToYou}</p>
        ) : null}
      </div>
      <ul className="flex flex-col divide-y">
        {rows.map((row) => (
          <BudgetCategoryRow
            key={`${row.categoryId}-${row.id ?? "spend"}`}
            currency={currency}
            locale={locale}
            periodMonth={periodMonth}
            row={row}
            translations={translations}
          />
        ))}
      </ul>
    </div>
  );
}

type BudgetCategoryRowProps = {
  currency: string;
  locale: string;
  periodMonth: string;
  row: BudgetRow;
  translations: Omit<BudgetCategoryListProps["translations"], "categories" | "visibleToYou">;
};

function BudgetCategoryRow({
  currency,
  locale,
  periodMonth,
  row,
  translations,
}: BudgetCategoryRowProps) {
  const { overBudget, percentUsed, progress } = getBudgetProgress(row);
  return (
    <li>
      <Link
        href={buildBudgetTransactionsHref(row.categoryId, periodMonth)}
        className="block py-4 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-5"
      >
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{row.name}</p>
              {row.merchants.length ? (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {row.merchants.join(" · ")}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-baseline gap-1 text-lg font-semibold tabular-nums">
              <span className={overBudget ? "text-destructive" : "text-foreground"}>
                {formatMoney(row.spent, currency, locale)}
              </span>
              <span className="text-muted-foreground">/</span>
              <span className={overBudget ? "text-destructive" : "text-muted-foreground"}>
                {formatMoney(Math.max(row.amount, 0), currency, locale)}
              </span>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                overBudget ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          {overBudget ? (
            <p className="mt-2 text-xs font-semibold text-destructive">
              {translations.overBy({
                amount: formatMoney(Math.abs(row.remaining), currency, locale),
              })}
            </p>
          ) : row.amount === 0 ? (
            <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-destructive">
              {translations.noBudget}
            </p>
          ) : (
            <p className="mt-2 text-xs font-semibold text-muted-foreground">
              {translations.percentUsed({ percent: percentUsed })}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}
