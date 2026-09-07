"use client";

import { useTranslations } from "next-intl";
import { ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTransactionsUiStore } from "@/store/transactions";

export function FirstRunPrompt({
  onDismiss,
  dismissLabel,
}: {
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const t = useTranslations("onboarding.firstRun");
  const openCreate = useTransactionsUiStore((s) => s.openCreate);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6 shadow-ring">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-black tracking-tight">{t("title")}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("subtitle")}</p>
        </div>
        {onDismiss ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDismiss}
            aria-label={dismissLabel ?? t("dismiss")}
            className="-mr-2 -mt-1 size-8 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>

      <Button
        type="button"
        size="lg"
        className="mt-4 w-full sm:w-auto"
        onClick={() => openCreate("transaction")}
      >
        {t("action")}
        <ArrowRight className="size-4" />
      </Button>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("hint")}</p>
    </div>
  );
}
