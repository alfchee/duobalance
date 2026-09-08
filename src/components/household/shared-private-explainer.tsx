"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Info, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { trackGuideOpen, type GuideSource } from "@/lib/guide-events";

const STORAGE_PREFIX = "duobalance:dismissed:sharedPrivateExplainer";

function storageKey(userId?: string | null): string {
  if (userId) return `${STORAGE_PREFIX}:${userId}`;
  return STORAGE_PREFIX;
}

function readDismissed(userId?: string | null): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(storageKey(userId)) === "true";
  } catch {
    return false;
  }
}

function writeDismissed(userId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(userId), "true");
  } catch {
    // storage disabled
  }
}

type Props = {
  userId?: string | null;
  source: GuideSource;
};

export function SharedPrivateExplainer({ userId, source }: Props) {
  const t = useTranslations("household.sharedPrivateExplainer");
  const helpHref = t("helpHref");
  const [dismissed, setDismissed] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed(userId));
    setHydrated(true);
  }, [userId]);

  const handleDismiss = useCallback(() => {
    writeDismissed(userId);
    setDismissed(true);
  }, [userId]);

  if (!hydrated || dismissed) return null;

  return (
    <div role="note" aria-label={t("title")} className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Info className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">{t("title")}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t("body")}</p>
          <Link
            href={helpHref}
            onClick={() => void trackGuideOpen(helpHref, source)}
            className="mt-2 inline-flex text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            {t("learnMore")}
          </Link>
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
    </div>
  );
}
