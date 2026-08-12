"use client";

import { useEffect, useState } from "react";
import type { CopyBudgetDraft } from "@/lib/budgets/model";
import { adjustCopyBudgetDrafts, replaceCopyBudgetDraftAmount } from "@/lib/budgets/model";
import { parseMoneyInput, roundToMinorUnit } from "@/lib/money";
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

type CopyBudgetsDialogProps = {
  drafts: readonly CopyBudgetDraft[];
  locale: string;
  minorUnit: number;
  onClose: () => void;
  onCopy: (drafts: readonly CopyBudgetDraft[]) => Promise<void>;
  open: boolean;
  pending: boolean;
  translations: {
    adjustment: string;
    cancel: string;
    confirm: string;
    copying: string;
    description: string;
    error: string;
    title: string;
  };
};

export function CopyBudgetsDialog({
  drafts: initialDrafts,
  locale,
  minorUnit,
  onClose,
  onCopy,
  open,
  pending,
  translations,
}: CopyBudgetsDialogProps) {
  const [drafts, setDrafts] = useState<CopyBudgetDraft[]>(() => [...initialDrafts]);
  const [adjustment, setAdjustment] = useState("0");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDrafts([...initialDrafts]);
    setAdjustment("0");
    setError(null);
  }, [initialDrafts, open]);

  const handleAdjustmentChange = (value: string) => {
    setAdjustment(value);
    setDrafts(
      adjustCopyBudgetDrafts(initialDrafts, Number(value), (amount) =>
        roundToMinorUnit(amount, minorUnit),
      ),
    );
  };

  const handleDraftAmountChange = (categoryId: string, value: string) => {
    const amount = parseMoneyInput(value, locale);
    if (amount === null || amount < 0) return;
    setDrafts((current) =>
      replaceCopyBudgetDraftAmount(current, categoryId, roundToMinorUnit(amount, minorUnit)),
    );
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="rounded-[30px]">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-2xl font-black tracking-tight">
            {translations.title}
          </DialogTitle>
          <DialogDescription className="text-sm">{translations.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {translations.adjustment}
          </Label>
          <Input
            className="rounded-full text-base"
            type="number"
            value={adjustment}
            onChange={(event) => handleAdjustmentChange(event.target.value)}
          />
        </div>
        <div className="max-h-72 space-y-3 overflow-y-auto rounded-[16px] border p-3 shadow-ring sm:p-4">
          {drafts.map((draft) => (
            <div
              key={draft.categoryId}
              className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2 hover:bg-secondary/50 sm:px-4 sm:py-3"
            >
              <span className="min-w-0 truncate font-semibold">{draft.name}</span>
              <Input
                className="w-36 rounded-full text-base tabular-nums"
                inputMode="decimal"
                value={draft.amount}
                onChange={(event) => handleDraftAmountChange(draft.categoryId, event.target.value)}
              />
            </div>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            className="rounded-full text-sm font-semibold"
            variant="outline"
            onClick={onClose}
          >
            {translations.cancel}
          </Button>
          <Button
            className="rounded-full text-sm font-semibold"
            disabled={pending || drafts.length === 0}
            onClick={() => void onCopy(drafts).catch(() => setError(translations.error))}
          >
            {pending ? translations.copying : translations.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
