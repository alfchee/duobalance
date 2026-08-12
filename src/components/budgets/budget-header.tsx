"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BudgetScope, BudgetSort } from "@/lib/budgets/model";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BudgetHeaderProps = {
  monthLabel: string;
  onNextMonth: () => void;
  onPreviousMonth: () => void;
  onScopeChange: (scope: BudgetScope) => void;
  onSortChange: (sort: BudgetSort) => void;
  scope: BudgetScope;
  sort: BudgetSort;
  translations: {
    household: string;
    mine: string;
    nextMonth: string;
    previousMonth: string;
    scopeLabel: string;
    sortLabel: string;
    sortName: string;
    sortRemaining: string;
    sortSpent: string;
    title: string;
  };
};

export function BudgetHeader({
  monthLabel,
  onNextMonth,
  onPreviousMonth,
  onScopeChange,
  onSortChange,
  scope,
  sort,
  translations,
}: BudgetHeaderProps) {
  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={translations.previousMonth}
            onClick={onPreviousMonth}
          >
            <ChevronLeft />
          </Button>
          <div className="flex flex-col">
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{translations.title}</h1>
            <p className="text-sm font-semibold text-muted-foreground">{monthLabel}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={translations.nextMonth}
            onClick={onNextMonth}
          >
            <ChevronRight />
          </Button>
        </div>
        <label className="sr-only" htmlFor="budget-sort">
          {translations.sortLabel}
        </label>
        <select
          id="budget-sort"
          className="rounded-full border bg-background px-4 py-2 text-sm font-semibold shadow-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as BudgetSort)}
        >
          <option value="spent">{translations.sortSpent}</option>
          <option value="remaining">{translations.sortRemaining}</option>
          <option value="name">{translations.sortName}</option>
        </select>
      </header>
      <div
        className="mx-auto inline-flex w-full max-w-md rounded-full bg-muted p-1 text-sm"
        role="group"
        aria-label={translations.scopeLabel}
      >
        {(["household", "mine"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={scope === value}
            onClick={() => onScopeChange(value)}
            className={cn(
              "flex-1 rounded-full px-4 py-2.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              scope === value
                ? "bg-background text-foreground shadow-ring"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "household" ? translations.household : translations.mine}
          </button>
        ))}
      </div>
    </>
  );
}
