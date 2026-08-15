"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import type { NumberFormatPref } from "@/lib/money";
import type { ReportCategoryKind, ReportCategoryTotal } from "@/hooks/useReports";

interface CategoryChartProps {
  title: string;
  kind: ReportCategoryKind;
  data: readonly ReportCategoryTotal[];
  currency: string;
  locale: string;
  numberFormat: NumberFormatPref;
  fromDate: string;
  toDate: string;
  memberId: string | null;
}

export function CategoryChartCard({
  title,
  kind,
  data,
  currency,
  locale,
  numberFormat,
  fromDate,
  toDate,
  memberId,
}: CategoryChartProps) {
  const t = useTranslations("reports");
  const totalAmount = data.reduce((acc, curr) => acc + Number(curr.total), 0);

  if (data.length === 0 || totalAmount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-bold">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t(`charts.${kind === "expense" ? "expenseByCategory" : "incomeByCategory"}.empty`)}
          </p>
        </CardContent>
      </Card>
    );
  }

  const circumference = 2 * Math.PI * 70;
  let accumulatedAngle = 0;

  const slices = data.map((item) => {
    const total = Number(item.total);
    const percentage = totalAmount > 0 ? total / totalAmount : 0;
    const strokeDasharray = `${circumference * percentage} ${circumference * (1 - percentage)}`;
    const strokeDashoffset = -circumference * accumulatedAngle;
    accumulatedAngle += percentage;
    return {
      ...item,
      total,
      percentage,
      strokeDasharray,
      strokeDashoffset,
    };
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-bold">{title}</CardTitle>
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">
          {formatMoney(totalAmount, currency, locale, numberFormat)}
        </span>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="relative mx-auto grid size-48 place-items-center">
          <svg viewBox="0 0 180 180" className="absolute inset-0 size-full -rotate-90">
            <circle cx="90" cy="90" r="70" fill="none" stroke="var(--border)" strokeWidth="16" />
            {slices.map((slice, i) => (
              <circle
                key={slice.category_id ?? `uncat-${i}`}
                cx="90"
                cy="90"
                r="70"
                fill="none"
                stroke={slice.color_hex || "#9ca3af"}
                strokeWidth="16"
                strokeDasharray={slice.strokeDasharray}
                strokeDashoffset={slice.strokeDashoffset}
                className="transition-all duration-300"
              />
            ))}
          </svg>
          <div className="relative z-10 flex flex-col items-center text-center">
            <span className="text-xs font-medium text-muted-foreground">
              {kind === "expense"
                ? t("charts.expenseByCategory.title")
                : t("charts.incomeByCategory.title")}
            </span>
            <span className="text-xl font-extrabold tabular-nums">
              {formatMoney(totalAmount, currency, locale, numberFormat)}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {slices.map((item, i) => {
            const displayName = item.category_name ?? t("uncategorized");
            const categoryParam = item.category_id ?? "uncategorized";
            const searchParams = new URLSearchParams({
              categories: categoryParam,
              type: kind,
              start: fromDate,
              end: toDate,
            });
            if (memberId) searchParams.set("member", memberId);

            return (
              <Link
                key={item.category_id ?? `row-${i}`}
                href={`/transactions?${searchParams.toString()}`}
                className="group block rounded-lg p-2 transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between text-sm font-semibold">
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color_hex || "#9ca3af" }}
                    />
                    <span className="truncate group-hover:underline">{displayName}</span>
                  </div>
                  <div className="flex items-center gap-2 tabular-nums">
                    <span>{formatMoney(item.total, currency, locale, numberFormat)}</span>
                    <span className="text-xs text-muted-foreground">
                      ({Math.round(item.percentage * 100)}%)
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(item.percentage * 100, 2)}%`,
                      backgroundColor: item.color_hex || "#9ca3af",
                    }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
