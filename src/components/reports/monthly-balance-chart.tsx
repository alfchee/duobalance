"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSignedMoney } from "@/lib/money";
import type { NumberFormatPref } from "@/lib/money";
import type { ReportMonthlyTotal } from "@/hooks/useReports";
import { calculateRolling3MonthAverage, formatReportMonthLabel } from "@/lib/reports";
import { cn } from "@/lib/utils";

interface MonthlyBalanceChartProps {
  data: readonly ReportMonthlyTotal[];
  currency: string;
  locale: string;
  numberFormat: NumberFormatPref;
}

export function MonthlyBalanceChart({
  data,
  currency,
  locale,
  numberFormat,
}: MonthlyBalanceChartProps) {
  const t = useTranslations("reports");

  if (data.length === 0) {
    return (
      <Card className="border-2 border-primary/20 shadow-md">
        <CardHeader>
          <CardTitle className="text-xl font-extrabold">
            {t("charts.monthlyBalance.title")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("charts.monthlyBalance.subtitle")}</p>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("charts.monthlyBalance.empty")}</p>
        </CardContent>
      </Card>
    );
  }

  const nets = data.map((d) => Number(d.net));
  const rolling3m = calculateRolling3MonthAverage(
    data.map((d) => ({ period_month: d.period_month, net: Number(d.net) })),
  );

  const allValues = [...nets, ...rolling3m];
  const maxAbs = Math.max(...allValues.map((v) => Math.abs(v)), 1);
  const totalNet = nets.reduce((acc, v) => acc + v, 0);

  return (
    <Card className="border-2 border-primary/20 shadow-md">
      <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between pb-2">
        <div>
          <CardTitle className="text-xl font-extrabold">
            {t("charts.monthlyBalance.title")}
          </CardTitle>
          <p className="text-xs font-medium text-muted-foreground">
            {t("charts.monthlyBalance.subtitle")}
          </p>
        </div>
        <div className="flex flex-col sm:items-end">
          <span
            className={cn(
              "text-lg font-black tabular-nums",
              totalNet >= 0 ? "text-success" : "text-destructive",
            )}
          >
            {formatSignedMoney(totalNet, currency, locale, numberFormat)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Legend */}
        <div className="flex items-center gap-4 text-xs font-semibold text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-success" />
            <span className="size-3 rounded-sm bg-destructive" />
            <span>{t("charts.monthlyBalance.title")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-primary" />
            <span>{t("charts.monthlyBalance.rollingAvg")}</span>
          </div>
        </div>

        {/* Chart area */}
        <div className="relative h-60 w-full pt-4 pb-6">
          <div className="relative flex h-full items-center justify-between gap-2">
            {data.map((item, index) => {
              const netVal = nets[index] ?? 0;
              const rollingVal = rolling3m[index] ?? 0;
              const barHeightPercent = Math.min((Math.abs(netVal) / maxAbs) * 100, 100);
              const isPositive = netVal >= 0;
              const monthLabel = formatReportMonthLabel(item.period_month, locale);

              return (
                <div
                  key={item.period_month}
                  className="group relative flex flex-1 flex-col items-center h-full justify-between"
                >
                  {/* Amount label */}
                  <div className="text-[10px] font-bold tabular-nums sm:text-xs">
                    {formatSignedMoney(netVal, currency, locale, numberFormat)}
                  </div>

                  {/* Dual pane bar representation split by zero line */}
                  <div className="relative w-full flex-1 flex flex-col my-1">
                    {/* Upper pane for positive bars */}
                    <div className="flex-1 flex items-end justify-center border-b border-dashed border-border pb-px">
                      {isPositive && (
                        <div
                          className="w-full max-w-[28px] rounded-t-sm bg-success transition-all duration-300"
                          style={{ height: `${Math.max(barHeightPercent, 4)}%` }}
                        />
                      )}
                    </div>
                    {/* Lower pane for negative bars */}
                    <div className="flex-1 flex items-start justify-center pt-px">
                      {!isPositive && (
                        <div
                          className="w-full max-w-[28px] rounded-b-sm bg-destructive transition-all duration-300"
                          style={{ height: `${Math.max(barHeightPercent, 4)}%` }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Month label */}
                  <div className="text-xs font-semibold text-muted-foreground truncate w-full text-center">
                    {monthLabel}
                  </div>

                  {/* Hover tooltip */}
                  <div className="pointer-events-none absolute -top-8 left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md group-hover:block">
                    {monthLabel}: {formatSignedMoney(netVal, currency, locale, numberFormat)} |{" "}
                    {t("charts.monthlyBalance.rollingAvg")}:{" "}
                    {formatSignedMoney(rollingVal, currency, locale, numberFormat)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
