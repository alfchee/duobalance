"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import type { NumberFormatPref } from "@/lib/money";
import { formatReportMonthLabel } from "@/lib/reports";
import type { ReportCategoryKind, ReportMonthlyTotal } from "@/hooks/useReports";

interface MonthlyBarChartProps {
  title: string;
  field: ReportCategoryKind;
  data: readonly ReportMonthlyTotal[];
  currency: string;
  locale: string;
  numberFormat: NumberFormatPref;
}

export function MonthlyBarChart({
  title,
  field,
  data,
  currency,
  locale,
  numberFormat,
}: MonthlyBarChartProps) {
  const t = useTranslations("reports");

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-bold">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t(`charts.${field === "expense" ? "monthlyExpenses" : "monthlyIncomes"}.empty`)}
          </p>
        </CardContent>
      </Card>
    );
  }

  const values = data.map((d) => Number(d[field]));
  const maxValue = Math.max(...values, 1);
  const totalSum = values.reduce((acc, v) => acc + v, 0);

  const barColor = field === "expense" ? "var(--destructive)" : "var(--primary)";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-bold">{title}</CardTitle>
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">
          {formatMoney(totalSum, currency, locale, numberFormat)}
        </span>
      </CardHeader>
      <CardContent>
        <div className="flex h-52 items-end justify-between gap-2 pt-6 pb-2">
          {data.map((item) => {
            const val = Number(item[field]);
            const heightPercent = maxValue > 0 ? (val / maxValue) * 100 : 0;
            const monthLabel = formatReportMonthLabel(item.period_month, locale);

            return (
              <div
                key={item.period_month}
                className="group relative flex flex-1 flex-col items-center h-full justify-end"
              >
                <div className="mb-1 text-[10px] font-semibold tabular-nums opacity-80 group-hover:opacity-100 sm:text-xs">
                  {val > 0
                    ? formatMoney(val, currency, locale, numberFormat)
                    : formatMoney(0, currency, locale, numberFormat)}
                </div>
                <div className="w-full flex-1 flex items-end justify-center">
                  <div
                    className="w-full max-w-[36px] rounded-t-md transition-all duration-300"
                    style={{
                      height: `${Math.max(heightPercent, 3)}%`,
                      backgroundColor: barColor,
                    }}
                  />
                </div>
                <span className="mt-2 text-xs font-medium text-muted-foreground truncate w-full text-center">
                  {monthLabel}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
