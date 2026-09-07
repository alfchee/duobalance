"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBudgetMutations } from "@/hooks/useBudgets";
import { useHousehold } from "@/hooks/useHousehold";
import { formatMoney, parseMoneyInput, roundToMinorUnit } from "@/lib/money";
import type { BudgetSuggestion } from "@/hooks/useBudgetSuggestion";

type Props = {
  open: boolean;
  onClose: () => void;
  suggestions: readonly BudgetSuggestion[];
  currency: string;
  locale: string;
  numberFormat: import("@/lib/money").NumberFormatPref;
  minorUnit: number;
  periodMonth: string;
  ownerMemberId: string | null;
  onCreated?: () => void;
};

export function BudgetSuggestionDialog({
  open,
  onClose,
  suggestions,
  currency,
  locale,
  numberFormat,
  minorUnit,
  periodMonth,
  ownerMemberId,
  onCreated,
}: Props) {
  const t = useTranslations("budget.suggestionDialog");
  const { householdId } = useHousehold();
  const { copy } = useBudgetMutations(householdId);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const initialDrafts = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of suggestions) {
      map[s.categoryId] = s.suggestedAmount.toString();
    }
    return map;
  }, [suggestions]);

  useEffect(() => {
    if (open) {
      setDrafts(initialDrafts);
      setError(null);
    }
  }, [open, initialDrafts]);

  async function handleCreate() {
    setError(null);
    const insertPayload: {
      amount: number;
      category_id: string;
      owner_member_id: string | null;
      period_month: string;
      rollover: boolean;
    }[] = [];
    for (const s of suggestions) {
      const raw = drafts[s.categoryId] ?? "";
      const parsed = parseMoneyInput(raw, locale, numberFormat);
      if (parsed === null || parsed < 0) {
        setError(t("validationAmount"));
        return;
      }
      const amount = roundToMinorUnit(parsed, minorUnit);
      insertPayload.push({
        amount,
        category_id: s.categoryId,
        owner_member_id: ownerMemberId,
        period_month: periodMonth,
        rollover: false,
      });
    }
    try {
      await copy.mutateAsync(insertPayload);
      onCreated?.();
      onClose();
    } catch {
      setError(t("error"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[24px]">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-xl font-black tracking-tight">{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground">{t("derivedLabel")}</p>
          {suggestions.map((s) => (
            <div key={s.categoryId} className="flex items-center gap-3 rounded-xl border p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("spentLabel", {
                    amount: formatMoney(s.spent, currency, locale, numberFormat),
                  })}
                </p>
              </div>
              <div className="w-32 shrink-0">
                <Label htmlFor={`suggestion-${s.categoryId}`} className="sr-only">
                  {s.name}
                </Label>
                <Input
                  id={`suggestion-${s.categoryId}`}
                  inputMode="decimal"
                  value={drafts[s.categoryId] ?? ""}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [s.categoryId]: e.target.value }))
                  }
                  className="rounded-full text-right tabular-nums"
                  placeholder={currency}
                />
              </div>
            </div>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" className="rounded-full" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            className="rounded-full"
            onClick={() => void handleCreate()}
            disabled={copy.isPending}
          >
            {copy.isPending ? t("creating") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
