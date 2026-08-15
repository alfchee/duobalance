"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SlidersHorizontal, CheckCircle2, AlertCircle } from "lucide-react";
import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdMembers } from "@/hooks/useHouseholdMembers";
import { useReportCategoryTotals, useReportMonthlyTotals } from "@/hooks/useReports";
import { getReportDateRange } from "@/lib/reports";
import type { DatePreset } from "@/lib/reports";
import { formatMoney } from "@/lib/money";
import { CategoryChartCard } from "./category-chart";
import { MonthlyBarChart } from "./monthly-bar-chart";
import { MonthlyBalanceChart } from "./monthly-balance-chart";

export function ReportsView() {
  const t = useTranslations("reports");
  const { householdId, baseCurrency, locale, timezone, numberFormat } = useHousehold();
  const { data: members = [] } = useHouseholdMembers(householdId);

  const activeTimezone = timezone ?? "UTC";
  const activeCurrency = baseCurrency ?? "USD";
  const activeLocale = locale ?? "es";

  const [datePreset, setDatePreset] = useState<DatePreset>("6m");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [memberFilter, setMemberFilter] = useState<string | null>(null);

  const { from, to } = getReportDateRange(
    datePreset,
    activeTimezone,
    new Date(),
    customFrom,
    customTo,
  );

  // Category total RPCs
  const { data: expenseCategories = [] } = useReportCategoryTotals(
    householdId,
    from,
    to,
    "expense",
    memberFilter,
  );
  const { data: incomeCategories = [] } = useReportCategoryTotals(
    householdId,
    from,
    to,
    "income",
    memberFilter,
  );

  // Monthly totals (filtered by member for trend charts)
  const { data: monthlyFiltered = [] } = useReportMonthlyTotals(
    householdId,
    from,
    to,
    memberFilter,
  );

  // Monthly totals (ALL members for Monthly Balance chart)
  const { data: monthlyAll = [] } = useReportMonthlyTotals(householdId, from, to, null);

  // Reconciliation check between category expense total and monthly expense sum
  const catExpenseTotal = expenseCategories.reduce((sum, item) => sum + Number(item.total), 0);
  const monthlyExpenseTotal = monthlyFiltered.reduce((sum, item) => sum + Number(item.expense), 0);
  const isReconciled = Math.abs(catExpenseTotal - monthlyExpenseTotal) < 0.01;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("title")}</h1>
          <p className="text-sm font-medium text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-secondary/80 px-3 py-1.5 text-xs font-semibold text-secondary-foreground self-start sm:self-auto">
          {t("currencyNotice", { currency: activeCurrency })}
        </div>
      </div>

      {/* Controls: Date Range & Member Filter */}
      <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          {/* Date range preset buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-muted-foreground">
              {t("dateRanges.label")}:
            </span>
            {(["this_month", "3m", "6m", "12m", "ytd", "custom"] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setDatePreset(preset)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  datePreset === preset
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {t(`dateRanges.${preset}`)}
              </button>
            ))}
          </div>

          {/* Member filter */}
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <span>{t("memberFilter.label")}:</span>
              <select
                value={memberFilter ?? ""}
                onChange={(e) => setMemberFilter(e.target.value ? e.target.value : null)}
                className="rounded-full border bg-background px-3 py-1 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{t("memberFilter.all")}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.display_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Custom Date Inputs if 'custom' is selected */}
        {datePreset === "custom" && (
          <div className="flex flex-wrap items-center gap-4 pt-2 border-t">
            <label className="flex items-center gap-2 text-xs font-semibold">
              <span>{t("customDates.from")}:</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-lg border bg-background px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold">
              <span>{t("customDates.to")}:</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-lg border bg-background px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
        )}
      </div>

      {/* Reconciliation Callout */}
      {monthlyFiltered.length > 0 && (
        <div
          className={`flex items-center gap-3 rounded-xl border p-3.5 text-xs font-semibold transition-colors ${
            isReconciled
              ? "border-success/30 bg-success/10 text-success-foreground"
              : "border-destructive/30 bg-destructive/10 text-destructive-foreground"
          }`}
        >
          {isReconciled ? (
            <CheckCircle2 className="size-4 shrink-0 text-success" />
          ) : (
            <AlertCircle className="size-4 shrink-0 text-destructive" />
          )}
          <span>
            {isReconciled
              ? t("reconciliation.matching", {
                  amount: formatMoney(catExpenseTotal, activeCurrency, activeLocale, numberFormat),
                })
              : t("reconciliation.mismatch", {
                  catTotal: formatMoney(
                    catExpenseTotal,
                    activeCurrency,
                    activeLocale,
                    numberFormat,
                  ),
                  monthlyTotal: formatMoney(
                    monthlyExpenseTotal,
                    activeCurrency,
                    activeLocale,
                    numberFormat,
                  ),
                })}
          </span>
        </div>
      )}

      {/* Monthly Balance Chart (Top feature chart) */}
      <MonthlyBalanceChart
        data={monthlyAll}
        currency={activeCurrency}
        locale={activeLocale}
        numberFormat={numberFormat}
        timezone={activeTimezone}
      />

      {/* Category Breakdown Charts Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        <CategoryChartCard
          title={t("charts.expenseByCategory.title")}
          kind="expense"
          data={expenseCategories}
          currency={activeCurrency}
          locale={activeLocale}
          numberFormat={numberFormat}
          fromDate={from}
          toDate={to}
          memberId={memberFilter}
        />
        <CategoryChartCard
          title={t("charts.incomeByCategory.title")}
          kind="income"
          data={incomeCategories}
          currency={activeCurrency}
          locale={activeLocale}
          numberFormat={numberFormat}
          fromDate={from}
          toDate={to}
          memberId={memberFilter}
        />
      </div>

      {/* Monthly Trend Charts Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        <MonthlyBarChart
          title={t("charts.monthlyExpenses.title")}
          field="expense"
          data={monthlyFiltered}
          currency={activeCurrency}
          locale={activeLocale}
          numberFormat={numberFormat}
          timezone={activeTimezone}
        />
        <MonthlyBarChart
          title={t("charts.monthlyIncomes.title")}
          field="income"
          data={monthlyFiltered}
          currency={activeCurrency}
          locale={activeLocale}
          numberFormat={numberFormat}
          timezone={activeTimezone}
        />
      </div>
    </div>
  );
}
