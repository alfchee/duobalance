"use client";

import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFxOverrides, type EffectiveRate } from "@/hooks/useFxOverrides";
import { formatRateDate } from "./fx-rates-section";

function formatUsdRate(rate: number, locale: string): string {
  // A rate like "1 USD = 36.6 NIO"; up to 6 decimals covers the precision the
  // seed/feed actually stores without trailing noise.
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(rate);
}

export function FxOverridesSection() {
  const t = useTranslations("settings.overrides");
  const locale = useLocale();
  const { data, isLoading, isError } = useFxOverrides();

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("loadError")}
          </p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border">
            {data.map((rate) => (
              <EffectiveRateRow key={rate.code} rate={rate} locale={locale} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EffectiveRateRow({ rate, locale }: { rate: EffectiveRate; locale: string }) {
  const t = useTranslations("settings.overrides");
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{rate.code}</p>
        {rate.note ? <p className="truncate text-xs text-muted-foreground">{rate.note}</p> : null}
      </div>
      <div className="text-right">
        <p>
          <span className="text-muted-foreground">1 USD = </span>
          <span className="font-medium">{formatUsdRate(rate.usdRate, locale)}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {t(rate.source === "override" ? "source.override" : "source.feed")} ·{" "}
          {formatRateDate(rate.rateDate, locale)}
        </p>
      </div>
    </li>
  );
}
