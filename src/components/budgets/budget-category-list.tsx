"use client";

import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { BudgetRow } from "@/lib/budgets/model";
import { buildBudgetTransactionsHref, getBudgetProgress } from "@/lib/budgets/model";
import { formatMoney } from "@/lib/money";
import type { NumberFormatPref } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type BudgetCategoryListProps = {
  currency: string;
  locale: string;
  numberFormat: NumberFormatPref;
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
  onEdit: (budgetId: string) => void;
  onDelete: (budgetId: string) => void;
  onCreate: (categoryId: string) => void;
  actions: { create: string; edit: string; delete: string };
};

export function BudgetCategoryList({
  currency,
  locale,
  numberFormat,
  periodMonth,
  rows,
  translations,
  visibleToHousehold,
  onDelete,
  onEdit,
  onCreate,
  actions,
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
            numberFormat={numberFormat}
            periodMonth={periodMonth}
            row={row}
            translations={translations}
            onDelete={onDelete}
            onEdit={onEdit}
            onCreate={onCreate}
            actions={actions}
          />
        ))}
      </ul>
    </div>
  );
}

type BudgetCategoryRowProps = {
  currency: string;
  locale: string;
  numberFormat: NumberFormatPref;
  periodMonth: string;
  row: BudgetRow;
  translations: Omit<BudgetCategoryListProps["translations"], "categories" | "visibleToYou">;
  onEdit: (budgetId: string) => void;
  onDelete: (budgetId: string) => void;
  onCreate: (categoryId: string) => void;
  actions: BudgetCategoryListProps["actions"];
};

function BudgetCategoryRow({
  currency,
  locale,
  numberFormat,
  periodMonth,
  row,
  translations,
  actions,
  onDelete,
  onEdit,
  onCreate,
}: BudgetCategoryRowProps) {
  const { overBudget, percentUsed, progress } = getBudgetProgress(row);
  return (
    <li>
      <div className="group relative py-4 transition-colors hover:bg-secondary/40 sm:py-5">
        <Link
          href={buildBudgetTransactionsHref(row.categoryId, periodMonth)}
          className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={row.name}
        />
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
                {formatMoney(row.spent, currency, locale, numberFormat)}
              </span>
              <span className="text-muted-foreground">/</span>
              <span className={overBudget ? "text-destructive" : "text-muted-foreground"}>
                {formatMoney(Math.max(row.amount, 0), currency, locale, numberFormat)}
              </span>
            </div>
            {row.id ? (
              <div className="relative z-10 ml-2 flex shrink-0 gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <Button
                  aria-label={actions.edit}
                  className="rounded-full"
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => onEdit(row.id!)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  aria-label={actions.delete}
                  className="rounded-full text-destructive hover:text-destructive"
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => onDelete(row.id!)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ) : (
              <div className="relative z-10 ml-2 shrink-0">
                <Button
                  aria-label={actions.create}
                  className="rounded-full"
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => onCreate(row.categoryId)}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            )}
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
                amount: formatMoney(Math.abs(row.remaining), currency, locale, numberFormat),
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
      </div>
    </li>
  );
}
