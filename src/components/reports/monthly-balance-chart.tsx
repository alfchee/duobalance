"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, formatSignedMoney } from "@/lib/money";
import type { NumberFormatPref } from "@/lib/money";
import type { ReportMonthlyTotal } from "@/hooks/useReports";
import { calculateRolling3MonthAverage } from "@/lib/reports";

interface MonthlyBalanceChartProps {
  data: readonly ReportMonthlyTotal[];
  currency: string;
  locale: string;
  numberFormat: NumberFormatPref;
  timezone: string;
}

function formatMonthLabel(periodMonth: string, locale: string, timezone: string): string {
  const date = new Date(`${periodMonth}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    month: "short",
    year: "2-digit",
  }).format(date);
}

export function MonthlyBalanceChart({
  data,
  currency,
  locale,
  numberFormat,
  timezone,
}: MonthlyBalanceChartProps) {
  const t = useTranslations("reports");

  if (data.length < 2) {
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

  // Height available for bars in SVG/container
  const chartHeight = 180;
  const zeroY = chartHeight / 2; // Middle baseline for positive/negative bars

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
            className={`text-lg font-black tabular-nums ${
              totalNet >= 0 ? "text-success" : "text-destructive"
            }`}
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

        {/* Chart area with SVG overlay */}
        <div className="relative h-56 w-full pt-4 pb-6">
          {/* Zero baseline */}
          <div
            className="absolute left-0 right-0 border-b border-dashed border-border"
            style={{ top: `${zeroY}px` }}
          />

          <div className="relative flex h-full items-center justify-between gap-2">
            {data.map((item, index) => {
              const netVal = nets[index] ?? 0;
              const rollingVal = rolling3m[index] ?? 0;
              const barHeight = (Math.abs(netVal) / maxAbs) * (chartHeight / 2 - 12);
              const isPositive = netVal >= 0;
              const monthLabel = formatMonthLabel(item.period_month, locale, timezone);

              return (
                <div
                  key={item.period_month}
                  className="group relative flex flex-1 flex-col items-center h-full justify-between"
                >
                  {/* Top / Value Label */}
                  <div className="text-[10px] font-bold tabular-nums sm:text-xs">
                    {formatMoney(netVal, currency, locale, numberFormat)}
                  </div>

                  {/* Bar container centered at zero line */}
                  <div className="relative w-full flex-1 flex items-center justify-center">
                    <div
                      className={`w-full max-w-[32px] rounded-sm transition-all duration-300 ${
                        isPositive ? "bg-success" : "bg-destructive"
                      }`}
                      style={{
                        height: `${Math.max(barHeight, 4)}px`,
                        transform: isPositive
                          ? `translateY(-${barHeight / 2}px)`
                          : `translateY(${barHeight / 2}px)`,
                      }}
                    />
                  </div>

                  {/* Month Label */}
                  <div className="text-xs font-semibold text-muted-foreground truncate w-full text-center">
                    {monthLabel}
                  </div>

                  {/* Tooltip on hover */}
                  <div className="pointer-events-none absolute -top-8 left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md group-hover:block">
                    {monthLabel}: {formatSignedMoney(netVal, currency, locale, numberFormat)} | 3M
                    Avg: {formatMoney(rollingVal, currency, locale, numberFormat)}
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
