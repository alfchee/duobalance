"use client";

import { useLocale, useTranslations } from "next-intl";
import { ApiError } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHousehold } from "@/hooks/useHousehold";
import { useFxRefresh, useFxRatesStatus } from "@/hooks/useFxRates";
import { daysSinceNewestRate } from "@/lib/fx/staleness";
import { todayInHousehold } from "@/lib/dates";
import { cn } from "@/lib/utils";

const STALE_AFTER_DAYS = 3;

// rate_date is the UTC day the rates are for; formatting it in the device
// timezone could show the previous day, so pin the formatter to UTC.
function formatRateDate(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

function refreshErrorKey(err: unknown): string {
  if (err instanceof ApiError && err.status === 401) return "notSignedIn";
  return "refreshError";
}

export function FxRatesSection() {
  const t = useTranslations("settings.fx");
  const locale = useLocale();
  const { timezone } = useHousehold();
  const status = useFxRatesStatus();
  const refresh = useFxRefresh();

  const today = timezone ? todayInHousehold(timezone) : new Date().toISOString().slice(0, 10);
  const newest = status.data?.[0]?.rate_date;
  const daysOld = daysSinceNewestRate(status.data ?? null, today);
  const stale = daysOld !== null && daysOld > STALE_AFTER_DAYS;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {newest ? (
          <p className={cn("text-sm", stale ? "text-destructive" : "text-muted-foreground")}>
            {t("lastUpdated", { date: formatRateDate(newest, locale) })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        )}

        {stale ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {t("stale", { days: daysOld })}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            {refresh.isPending ? t("refreshing") : t("refresh")}
          </Button>
          {refresh.isSuccess && refresh.data ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("refreshSuccess", refresh.data)}
            </p>
          ) : null}
          {refresh.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t(refreshErrorKey(refresh.error))}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
