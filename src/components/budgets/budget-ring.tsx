"use client";

import { formatMoney } from "@/lib/money";

type BudgetRingProps = {
  currency: string;
  locale: string;
  spent: number;
  totalBudget: number;
  ariaLabel: string;
  chartCenter: string;
  ofBudget: (values: { amount: string }) => string;
  leftLabel: string;
};

export function BudgetRing({
  ariaLabel,
  chartCenter,
  currency,
  leftLabel,
  locale,
  ofBudget,
  spent,
  totalBudget,
}: BudgetRingProps) {
  const overBudget = totalBudget > 0 && spent > totalBudget;
  const progress = totalBudget > 0 ? Math.min(spent / totalBudget, 1) : 0;
  const circumference = 2 * Math.PI * 80;
  const dash = circumference * progress;
  const remaining = Math.max(totalBudget - spent, 0);
  return (
    <div
      className="relative mx-auto grid size-64 place-items-center"
      role="img"
      aria-label={ariaLabel}
    >
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full -rotate-90">
        <circle cx="100" cy="100" r="80" fill="none" stroke="var(--background)" strokeWidth="18" />
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke={overBudget ? "var(--destructive)" : "var(--primary)"}
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <div className="relative z-10 flex flex-col items-center">
        <p className="text-4xl font-black tracking-tight tabular-nums sm:text-5xl">
          {formatMoney(spent, currency, locale)}
        </p>
        {totalBudget > 0 ? (
          <p className="mt-1 text-sm font-semibold text-muted-foreground tabular-nums">
            {ofBudget({ amount: formatMoney(totalBudget, currency, locale) })} ·{" "}
            {formatMoney(remaining, currency, locale)} {leftLabel}
          </p>
        ) : (
          <p className="mt-1 text-sm font-semibold text-muted-foreground">{chartCenter}</p>
        )}
      </div>
    </div>
  );
}
