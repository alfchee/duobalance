"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { parseMoneyInput, roundToMinorUnit, type NumberFormatPref } from "@/lib/money";
import type { BudgetRow } from "@/lib/budgets/model";
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

type BudgetEditorDialogProps = {
  categories: readonly { id: string; name: string }[];
  currency: string;
  editingBudget: BudgetRow | null;
  initialCategoryId: string | null;
  locale: string;
  minorUnit: number;
  numberFormat: NumberFormatPref;
  onClose: () => void;
  onSave: (draft: { amount: number; categoryId: string; rollover: boolean }) => Promise<void>;
  open: boolean;
  pending: boolean;
  translations: {
    amount: string;
    cancel: string;
    category: string;
    createDescription: string;
    createTitle: string;
    editDescription: string;
    editTitle: string;
    save: string;
    saving: string;
    selectCategory: string;
    validationAmount: string;
    validationCategory: string;
    error: string;
    rollover: string;
  };
};

type Draft = { amount: string; categoryId: string; rollover: boolean };
type FormSubmitEvent = Parameters<NonNullable<ComponentProps<"form">["onSubmit"]>>[0];

function initialDraft(editingBudget: BudgetRow | null, initialCategoryId: string | null): Draft {
  return {
    amount: editingBudget?.amount.toString() ?? "",
    categoryId: editingBudget?.categoryId ?? initialCategoryId ?? "",
    rollover: editingBudget?.rollover ?? false,
  };
}

export function BudgetEditorDialog({
  categories,
  currency,
  editingBudget,
  initialCategoryId,
  locale,
  minorUnit,
  numberFormat,
  onClose,
  onSave,
  open,
  pending,
  translations,
}: BudgetEditorDialogProps) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(editingBudget, initialCategoryId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initialDraft(editingBudget, initialCategoryId));
    setError(null);
  }, [editingBudget, initialCategoryId, open]);

  const handleSubmit = async (event: FormSubmitEvent) => {
    event.preventDefault();
    const amount = parseMoneyInput(draft.amount, locale, numberFormat);
    if (!draft.categoryId) return setError(translations.validationCategory);
    if (amount === null || amount < 0) return setError(translations.validationAmount);
    setError(null);
    try {
      await onSave({
        amount: roundToMinorUnit(amount, minorUnit),
        categoryId: draft.categoryId,
        rollover: draft.rollover,
      });
    } catch {
      setError(translations.error);
    }
  };

  const editing = editingBudget !== null;
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="rounded-[30px]">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-2xl font-black tracking-tight">
            {editing ? translations.editTitle : translations.createTitle}
          </DialogTitle>
          <DialogDescription>
            {editing ? translations.editDescription : translations.createDescription}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1">
            <Label htmlFor="budget-category">{translations.category}</Label>
            <select
              id="budget-category"
              className="h-10 w-full rounded-full border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draft.categoryId}
              onChange={(event) =>
                setDraft((current) => ({ ...current, categoryId: event.target.value }))
              }
            >
              <option value="">{translations.selectCategory}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="budget-amount">{translations.amount}</Label>
            <Input
              id="budget-amount"
              className="rounded-full tabular-nums"
              inputMode="decimal"
              placeholder={currency}
              value={draft.amount}
              onChange={(event) =>
                setDraft((current) => ({ ...current, amount: event.target.value }))
              }
            />
          </div>
          <Label className="flex cursor-pointer items-center gap-3 rounded-2xl border p-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={draft.rollover}
              onChange={(event) =>
                setDraft((current) => ({ ...current, rollover: event.target.checked }))
              }
            />
            {translations.rollover}
          </Label>
          {error ? (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button className="rounded-full" type="button" variant="outline" onClick={onClose}>
              {translations.cancel}
            </Button>
            <Button className="rounded-full" disabled={pending} type="submit">
              {pending ? translations.saving : translations.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DeleteBudgetDialogProps = {
  open: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  translations: {
    cancel: string;
    confirm: string;
    description: string;
    error: string;
    title: string;
  };
};

export function DeleteBudgetDialog({
  onCancel,
  onConfirm,
  open,
  pending,
  translations,
}: DeleteBudgetDialogProps) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent className="rounded-[30px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tight">
            {translations.title}
          </DialogTitle>
          <DialogDescription>{translations.description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button className="rounded-full" variant="outline" onClick={onCancel}>
            {translations.cancel}
          </Button>
          <Button
            className="rounded-full"
            variant="destructive"
            disabled={pending}
            onClick={() => void onConfirm().catch(() => setError(translations.error))}
          >
            {translations.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
