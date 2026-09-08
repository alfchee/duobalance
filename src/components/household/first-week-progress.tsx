"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useHousehold } from "@/hooks/useHousehold";
import { useFirstWeekProgress } from "@/hooks/useFirstWeekProgress";
import { addDays } from "@/lib/dates";
import { Button } from "@/components/ui/button";

const DISMISS_PREFIX = "duobalance:dismissedFirstWeek:";

function readDismissed(householdId: string | null): boolean {
  if (typeof window === "undefined" || !householdId) return true;
  try {
    return localStorage.getItem(`${DISMISS_PREFIX}${householdId}`) === "true";
  } catch {
    return false;
  }
}

function writeDismissed(householdId: string | null): void {
  if (typeof window === "undefined" || !householdId) return;
  try {
    localStorage.setItem(`${DISMISS_PREFIX}${householdId}`, "true");
  } catch {
    // ignore
  }
}

export function FirstWeekProgress() {
  const t = useTranslations("onboarding.firstWeek");
  const { householdId, timezone } = useHousehold();
  const progress = useFirstWeekProgress(householdId, timezone);

  const [dismissed, setDismissed] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!householdId) {
      setHydrated(true);
      return;
    }
    setDismissed(readDismissed(householdId));
    setHydrated(true);
  }, [householdId]);

  const handleDismiss = useCallback(() => {
    writeDismissed(householdId);
    setDismissed(true);
  }, [householdId]);

  if (!hydrated || !householdId) return null;
  if (dismissed) return null;
  if (progress.isLoading) return null;
  if (!progress.startDate || !progress.today) return null;
  if (progress.isBeforeWeek) return null;

  // Don't show retroactively to long-standing households. The nudge is for
  // the first two weeks after household creation; beyond that it would be
  // confusing to suddenly prompt a "first week" completion.
  // Before this feature veterans would never have seen it, so we expiry-gate
  // past households rather than forcing a manual dismiss.
  if (progress.isPastWeek && progress.daysSinceStart > 14) return null;

  const isWeekComplete = progress.isWeekComplete;

  return (
    <div
      role="status"
      aria-label={t("title")}
      className="mx-auto w-full max-w-2xl px-4 sm:px-6"
      data-testid="first-week-progress"
    >
      <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
              {t("badge")}
            </span>
            <h3 className="mt-2 text-sm font-bold tracking-tight">
              {isWeekComplete ? t("daySevenTitle") : t("title")}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {isWeekComplete ? t("daySevenBody") : t("subtitle")}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            aria-label={t("dismiss")}
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="mt-4" aria-live="polite">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: progress.totalDays }).map((_, index) => {
              const date = progress.startDate ? addDays(progress.startDate, index) : null;
              const filled = !!date && progress.distinctDays.includes(date);
              return (
                <span
                  key={index}
                  className={`h-2 flex-1 rounded-full transition-colors ${
                    filled ? "bg-primary" : "bg-secondary"
                  }`}
                  data-testid={filled ? "first-week-dot-filled" : "first-week-dot-empty"}
                />
              );
            })}
          </div>
          <p className="mt-2 text-xs font-semibold text-muted-foreground">
            {t("progressLabel", {
              count: progress.daysRecorded,
              total: progress.totalDays,
            })}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("hint")}</p>
        </div>

        {isWeekComplete ? (
          <Button asChild size="sm" className="mt-4 w-full sm:w-auto">
            <Link href="/reports">{t("daySevenCta")}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
