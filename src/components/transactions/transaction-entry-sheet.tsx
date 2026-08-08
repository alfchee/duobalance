"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CurrencyPicker } from "@/components/accounts/currency-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategorizationRules, useCategories } from "@/hooks/useCategories";
import { useCurrencies } from "@/hooks/useCurrencies";
import { useFxOverrides } from "@/hooks/useFxOverrides";
import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdMembers } from "@/hooks/useHouseholdMembers";
import {
  useFxRateOn,
  useTransactionDescriptions,
  useTransactionMutations,
} from "@/hooks/useTransactions";
import { matchCategory } from "@/lib/categories";
import { todayInHousehold } from "@/lib/dates";
import {
  appendMoneyPadInput,
  formatMoneyInput,
  maskMoneyInput,
  parseMoneyInput,
  roundToMinorUnit,
} from "@/lib/money";
import type { Transaction } from "@/lib/transactions";
import { useTransactionsUiStore } from "@/store/transactions";

const LAST_ACCOUNT_STORAGE_KEY = "duobalance:lastTransactionAccountId";
const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"] as const;

type Draft = {
  amount: string;
  description: string;
  accountId: string;
  categoryId: string | null;
  currency: string;
  occurredOn: string;
  spentBy: string | null;
  fxRate: string;
  notes: string;
  isExpense: boolean;
};

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function makeDraft(
  transaction: Transaction | null,
  today: string,
  lastAccountId: string | null,
  memberId: string | null,
  locale: string,
): Draft {
  return {
    amount: transaction ? formatMoneyInput(Math.abs(transaction.amount), locale) : "",
    description: transaction?.description ?? "",
    accountId: transaction?.account_id ?? lastAccountId ?? "",
    categoryId: transaction?.category_id ?? null,
    currency: transaction?.currency ?? "",
    occurredOn: transaction?.occurred_on ?? today,
    spentBy: transaction?.spent_by ?? memberId,
    fxRate: String(transaction?.fx_rate ?? 1),
    notes: transaction?.notes ?? "",
    isExpense: transaction ? transaction.amount < 0 : true,
  };
}

export function TransactionEntrySheet() {
  const { formOpen, editingTransaction, closeForm } = useTransactionsUiStore();
  const { timezone, memberId } = useHousehold();
  const today = timezone ? todayInHousehold(timezone) : "";
  const lastAccountId =
    typeof window === "undefined" ? null : localStorage.getItem(LAST_ACCOUNT_STORAGE_KEY);

  return (
    <Sheet open={formOpen} onOpenChange={(open) => !open && closeForm()}>
      <TransactionEntryContent
        key={editingTransaction?.id ?? "create"}
        transaction={editingTransaction}
        today={today}
        lastAccountId={lastAccountId}
        memberId={memberId}
        onClose={closeForm}
      />
    </Sheet>
  );
}

function TransactionEntryContent({
  transaction,
  today,
  lastAccountId,
  memberId,
  onClose,
}: {
  transaction: Transaction | null;
  today: string;
  lastAccountId: string | null;
  memberId: string | null;
  onClose: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("transactions");
  const { householdId, baseCurrency } = useHousehold();
  const { data: accounts = [] } = useAccounts(householdId);
  const { data: categories = [] } = useCategories(householdId);
  const { data: rules = [] } = useCategorizationRules(householdId);
  const { data: currencies = [] } = useCurrencies();
  const { data: members = [] } = useHouseholdMembers(householdId);
  const { data: descriptions = [] } = useTransactionDescriptions(householdId);
  const { data: effectiveRates = [] } = useFxOverrides();
  const [draft, setDraft] = useState(() =>
    makeDraft(transaction, today, lastAccountId, memberId, locale),
  );
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryOverridden, setCategoryOverridden] = useState(transaction !== null);
  const [fxRateOverridden, setFxRateOverridden] = useState(transaction !== null);
  const amountRef = useRef<HTMLInputElement>(null);
  const selectedAccount = accounts.find((account) => account.id === draft.accountId) ?? null;
  const minorUnit =
    currencies.find((currency) => currency.code === draft.currency)?.minor_unit ?? 2;
  const isForeignCurrency = !!draft.currency && !!baseCurrency && draft.currency !== baseCurrency;
  const rateQuery = useFxRateOn(
    householdId,
    draft.occurredOn,
    draft.currency || null,
    baseCurrency,
    isForeignCurrency,
  );
  const { create, update, remove } = useTransactionMutations(householdId, memberId);
  const pending = create.isPending || update.isPending || remove.isPending;
  const categoryKind = draft.isExpense ? "expense" : "income";
  const usableAccounts = accounts.filter((account) => !account.is_archived);
  const usableCategories = categories.filter(
    (category) => !category.is_archived && category.kind === categoryKind,
  );
  const effectiveRate = effectiveRates.find((rate) => rate.code === draft.currency);

  useEffect(() => {
    if (!draft.accountId && usableAccounts[0]) {
      setDraft((current) => ({
        ...current,
        accountId: usableAccounts[0]!.id,
        currency: usableAccounts[0]!.currency,
      }));
    }
  }, [draft.accountId, usableAccounts]);

  useEffect(() => {
    if (!categoryOverridden) {
      const categoryId = matchCategory(draft.description, rules);
      const category = categories.find((item) => item.id === categoryId);
      setDraft((current) => ({
        ...current,
        categoryId:
          category?.kind === (current.isExpense ? "expense" : "income") ? categoryId : null,
      }));
    }
  }, [categories, categoryOverridden, draft.description, rules]);

  useEffect(() => {
    if (isForeignCurrency && !fxRateOverridden && rateQuery.data != null) {
      setDraft((current) => ({ ...current, fxRate: String(rateQuery.data) }));
    }
  }, [fxRateOverridden, isForeignCurrency, rateQuery.data]);

  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  function setAccount(accountId: string) {
    const account = accounts.find((item) => item.id === accountId);
    if (!account) return;
    setFxRateOverridden(false);
    setDraft((current) => ({
      ...current,
      accountId,
      currency: account.currency,
      fxRate: account.currency === baseCurrency ? "1" : current.fxRate,
    }));
  }

  function setCurrency(currency: string) {
    setFxRateOverridden(false);
    setDraft((current) => ({
      ...current,
      currency,
      fxRate: currency === baseCurrency ? "1" : current.fxRate,
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const description = draft.description.trim();
    const amount = parseMoneyInput(draft.amount, locale);
    const fxRate = Number(draft.fxRate);
    if (!description || description.length > 200) return setError("description");
    if (!draft.accountId) return setError("account");
    if (amount == null || amount === 0) return setError("amount");
    if (!draft.currency || !Number.isFinite(fxRate) || fxRate <= 0) return setError("rate");
    if (!draft.occurredOn || (today && draft.occurredOn > addDays(today, 1)))
      return setError("date");

    const inputMinorUnit =
      currencies.find((currency) => currency.code === draft.currency)?.minor_unit ?? 2;
    const input = {
      account_id: draft.accountId,
      amount: draft.isExpense
        ? -roundToMinorUnit(amount, inputMinorUnit)
        : roundToMinorUnit(amount, inputMinorUnit),
      category_id: draft.categoryId,
      currency: draft.currency,
      description,
      fx_rate: fxRate,
      notes: draft.notes.trim() || null,
      occurred_on: draft.occurredOn,
      spent_by: draft.spentBy,
    };

    try {
      if (transaction) await update.mutateAsync({ id: transaction.id, ...input });
      else await create.mutateAsync(input);
      localStorage.setItem(LAST_ACCOUNT_STORAGE_KEY, draft.accountId);
      onClose();
    } catch {
      setError("generic");
    }
  }

  async function handleDelete() {
    if (!transaction) return;
    setError(null);
    try {
      await remove.mutateAsync(transaction.id);
      onClose();
    } catch {
      setError("generic");
    }
  }

  return (
    <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto sm:mx-auto sm:max-w-2xl">
      <SheetHeader>
        <SheetTitle>{transaction ? t("form.editTitle") : t("form.title")}</SheetTitle>
        <SheetDescription>{t("form.description")}</SheetDescription>
      </SheetHeader>
      <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-6">
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={draft.isExpense ? "default" : "outline"}
            onClick={() =>
              setDraft((current) => ({ ...current, isExpense: true, categoryId: null }))
            }
          >
            {t("form.expense")}
          </Button>
          <Button
            type="button"
            variant={!draft.isExpense ? "default" : "outline"}
            onClick={() =>
              setDraft((current) => ({ ...current, isExpense: false, categoryId: null }))
            }
          >
            {t("form.income")}
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="transaction-amount">{t("form.amount")}</Label>
          <Input
            ref={amountRef}
            id="transaction-amount"
            value={draft.amount}
            readOnly
            inputMode="none"
            className="h-14 text-2xl"
          />
          <div className="grid grid-cols-3 gap-2">
            {PAD_KEYS.map((key) => (
              <Button
                key={key}
                type="button"
                variant="outline"
                className="h-12 text-lg"
                aria-label={key === "backspace" ? t("form.backspace") : key}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    amount: appendMoneyPadInput(current.amount, key, locale, minorUnit),
                  }))
                }
              >
                {key === "backspace" ? "⌫" : key === "." ? t("form.decimal") : key}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="transaction-description">{t("form.descriptionLabel")}</Label>
          <Input
            id="transaction-description"
            value={draft.description}
            maxLength={200}
            list="transaction-descriptions"
            placeholder={t("form.descriptionPlaceholder")}
            onChange={(event) =>
              setDraft((current) => ({ ...current, description: event.target.value }))
            }
          />
          <datalist id="transaction-descriptions">
            {descriptions.map((description) => (
              <option key={description} value={description} />
            ))}
          </datalist>
        </div>

        <div className="space-y-2">
          <Label>{t("form.account")}</Label>
          <Select value={draft.accountId} onValueChange={setAccount}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("form.accountPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {usableAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("form.currency")}</Label>
          <CurrencyPicker value={draft.currency || null} onSelect={setCurrency} />
        </div>

        <div className="space-y-2">
          <Label>{t("form.category")}</Label>
          <Select
            value={draft.categoryId ?? "none"}
            onValueChange={(categoryId) => {
              setCategoryOverridden(true);
              setDraft((current) => ({
                ...current,
                categoryId: categoryId === "none" ? null : categoryId,
              }));
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("form.categoryPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("form.noCategory")}</SelectItem>
              {usableCategories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="transaction-date">{t("form.date")}</Label>
            <Input
              id="transaction-date"
              type="date"
              value={draft.occurredOn}
              max={today ? addDays(today, 1) : undefined}
              onChange={(event) => {
                setFxRateOverridden(false);
                setDraft((current) => ({ ...current, occurredOn: event.target.value }));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("form.spentBy")}</Label>
            <Select
              value={draft.spentBy ?? "joint"}
              onValueChange={(spentBy) =>
                setDraft((current) => ({
                  ...current,
                  spentBy: spentBy === "joint" ? null : spentBy,
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="joint">{t("form.joint")}</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isForeignCurrency ? (
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor="transaction-rate">{t("form.fxRate")}</Label>
            <Input
              id="transaction-rate"
              inputMode="decimal"
              value={draft.fxRate}
              onChange={(event) => {
                setFxRateOverridden(true);
                setDraft((current) => ({
                  ...current,
                  fxRate: maskMoneyInput(event.target.value, "en", 8),
                }));
              }}
            />
            <p className="text-xs text-muted-foreground">
              {effectiveRate
                ? t("form.rateSource", {
                    source: t(`form.rateSources.${effectiveRate.source}`),
                    date: effectiveRate.rateDate,
                  })
                : t("form.rateLoading")}
            </p>
          </div>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => setShowMore((value) => !value)}
        >
          {showMore ? t("form.less") : t("form.more")}
        </Button>
        {showMore ? (
          <div className="space-y-2">
            <Label htmlFor="transaction-notes">{t("form.notes")}</Label>
            <Input
              id="transaction-notes"
              value={draft.notes}
              onChange={(event) =>
                setDraft((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(`form.errors.${error}`)}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={pending || !selectedAccount}>
            {pending ? t("form.saving") : t("form.save")}
          </Button>
          {transaction ? (
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={pending}>
              {t("form.delete")}
            </Button>
          ) : null}
        </div>
      </form>
    </SheetContent>
  );
}
