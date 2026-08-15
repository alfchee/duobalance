"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CurrencyPicker } from "@/components/accounts/currency-picker";
import { HelpButton } from "@/components/help/help-button";
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
  formatSignedMoney,
  maskMoneyInput,
  parseMoneyInput,
  roundToMinorUnit,
} from "@/lib/money";
import type { Transaction } from "@/lib/transactions";
import type { AccountWithBalance } from "@/lib/accounts";
import { useTransactionsUiStore } from "@/store/transactions";
import { useOfflineQueue } from "@/components/realtime-status";

const LAST_ACCOUNT_STORAGE_KEY = "duobalance:lastTransactionAccountId";
const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"] as const;
const ENTRY_SHEET_CLASS_NAME =
  "max-h-[92dvh] overflow-y-auto rounded-t-[2rem] sm:top-1/2 sm:right-auto sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[2rem]";

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

function findMinorUnit(
  currencies: readonly { code: string; minor_unit: number }[],
  code: string | null,
): number | null {
  if (!code) return null;
  return currencies.find((currency) => currency.code === code)?.minor_unit ?? null;
}

// Only reroute to the offline queue when the failure genuinely looks like a
// connectivity problem — a structured API/DB error (it carries a string
// `code`, e.g. an RLS denial or constraint violation) is never transient,
// even if its message happens to contain a network-sounding word.
function isTransientWriteError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (!error || typeof error !== "object") return false;
  const { code, message, name } = error as { code?: unknown; message?: unknown; name?: unknown };
  if (typeof code === "string") return false;
  if (name === "AbortError") return true;
  return (
    typeof message === "string" && /network|failed to fetch|load failed|timeout/i.test(message)
  );
}

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
  numberFormat: import("@/lib/money").NumberFormatPref,
): Draft {
  return {
    amount: transaction ? formatMoneyInput(Math.abs(transaction.amount), locale, numberFormat) : "",
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
  const { formOpen, editingTransaction, createMode, closeForm } = useTransactionsUiStore();
  const { timezone, memberId } = useHousehold();
  const today = timezone ? todayInHousehold(timezone) : "";
  const lastAccountId =
    typeof window === "undefined" ? null : localStorage.getItem(LAST_ACCOUNT_STORAGE_KEY);

  return (
    <Sheet open={formOpen} onOpenChange={(open) => !open && closeForm()}>
      {createMode === "transfer" && !editingTransaction ? (
        <TransferEntryContent
          key="transfer"
          today={today}
          lastAccountId={lastAccountId}
          memberId={memberId}
          onClose={closeForm}
        />
      ) : (
        <TransactionEntryContent
          key={editingTransaction?.id ?? "create"}
          transaction={editingTransaction}
          today={today}
          lastAccountId={lastAccountId}
          memberId={memberId}
          onClose={closeForm}
        />
      )}
    </Sheet>
  );
}

function TransferEntryContent({
  today,
  lastAccountId,
  memberId,
  onClose,
}: {
  today: string;
  lastAccountId: string | null;
  memberId: string | null;
  onClose: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("transactions");
  const { householdId, baseCurrency, numberFormat } = useHousehold();
  const { data: accounts = [] } = useAccounts(householdId);
  const { data: currencies = [] } = useCurrencies();
  const { createTransfer } = useTransactionMutations(householdId, memberId);
  const { connectionState } = useOfflineQueue();
  const [fromAccountId, setFromAccountId] = useState(lastAccountId ?? "");
  const [toAccountId, setToAccountId] = useState("");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [description, setDescription] = useState("");
  const [fromFxRate, setFromFxRate] = useState("1");
  const [toFxRate, setToFxRate] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const usableAccounts = accounts.filter((account) => !account.is_archived);
  const fromAccount = usableAccounts.find((account) => account.id === fromAccountId) ?? null;
  const toAccount = usableAccounts.find((account) => account.id === toAccountId) ?? null;
  const fromMinorUnit = findMinorUnit(currencies, fromAccount?.currency ?? null);
  const toMinorUnit = findMinorUnit(currencies, toAccount?.currency ?? null);
  const fromRateQuery = useFxRateOn(
    householdId,
    occurredOn,
    fromAccount?.currency ?? null,
    baseCurrency,
    !!fromAccount && fromAccount.currency !== baseCurrency,
  );
  const toRateQuery = useFxRateOn(
    householdId,
    occurredOn,
    toAccount?.currency ?? null,
    baseCurrency,
    !!toAccount && toAccount.currency !== baseCurrency,
  );

  useEffect(() => {
    if (!fromAccountId && usableAccounts[0]) setFromAccountId(usableAccounts[0].id);
  }, [fromAccountId, usableAccounts]);

  useEffect(() => {
    if (fromAccount?.currency === baseCurrency) setFromFxRate("1");
    else if (fromRateQuery.data != null) setFromFxRate(String(fromRateQuery.data));
  }, [baseCurrency, fromAccount?.currency, fromRateQuery.data]);

  useEffect(() => {
    if (toAccount?.currency === baseCurrency) setToFxRate("1");
    else if (toRateQuery.data != null) setToFxRate(String(toRateQuery.data));
  }, [baseCurrency, toAccount?.currency, toRateQuery.data]);

  function setSource(accountId: string) {
    setFromAccountId(accountId);
    if (accountId === toAccountId) setToAccountId("");
  }

  function setDestination(accountId: string) {
    setToAccountId(accountId);
    if (accountId === fromAccountId) setFromAccountId("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsedFromAmount = parseMoneyInput(fromAmount, locale, numberFormat);
    const parsedToAmount = parseMoneyInput(toAmount, locale, numberFormat);
    const parsedFromRate = Number(fromFxRate);
    const parsedToRate = Number(toFxRate);
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId)
      return setError("transferAccounts");
    if (
      parsedFromAmount == null ||
      parsedFromAmount <= 0 ||
      parsedToAmount == null ||
      parsedToAmount <= 0
    )
      return setError("amount");
    if (
      !Number.isFinite(parsedFromRate) ||
      parsedFromRate <= 0 ||
      !Number.isFinite(parsedToRate) ||
      parsedToRate <= 0
    )
      return setError("rate");
    if (!occurredOn || (today && occurredOn > addDays(today, 1))) return setError("date");
    if (fromMinorUnit == null || toMinorUnit == null) return setError("amount");
    if (connectionState === "offline") return setError("offlineTransfer");
    try {
      await createTransfer.mutateAsync({
        description: description.trim() || t("form.transferDefaultDescription"),
        fromAccountId,
        fromAmount: roundToMinorUnit(parsedFromAmount, fromMinorUnit),
        fromFxRate: parsedFromRate,
        occurredOn,
        toAccountId,
        toAmount: roundToMinorUnit(parsedToAmount, toMinorUnit),
        toFxRate: parsedToRate,
      });
      localStorage.setItem(LAST_ACCOUNT_STORAGE_KEY, fromAccountId);
      onClose();
    } catch {
      setError("generic");
    }
  }

  return (
    <SheetContent side="bottom" className={ENTRY_SHEET_CLASS_NAME}>
      <SheetHeader className="border-b px-6 pb-5 pt-6">
        <SheetTitle className="text-2xl font-black tracking-tight">
          {t("form.transferTitle")}
        </SheetTitle>
        <SheetDescription>{t("form.transferDescription")}</SheetDescription>
      </SheetHeader>
      <form onSubmit={handleSubmit} className="space-y-5 px-6 pb-8 pt-2">
        <TransferAccountSelect
          accounts={usableAccounts}
          label={t("form.fromAccount")}
          value={fromAccountId}
          onChange={setSource}
          placeholder={t("form.accountPlaceholder")}
        />
        <TransferAmountField
          id="transfer-from-amount"
          label={t("form.fromAmount", { currency: fromAccount?.currency ?? "" })}
          value={fromAmount}
          locale={locale}
          minorUnit={fromMinorUnit ?? 0}
          numberFormat={numberFormat}
          disabled={fromMinorUnit == null}
          onChange={setFromAmount}
        />
        {fromAccount?.currency !== baseCurrency ? (
          <TransferRateField value={fromFxRate} onChange={setFromFxRate} label={t("form.fxRate")} />
        ) : null}
        <TransferAccountSelect
          accounts={usableAccounts}
          label={t("form.toAccount")}
          value={toAccountId}
          onChange={setDestination}
          placeholder={t("form.accountPlaceholder")}
        />
        <TransferAmountField
          id="transfer-to-amount"
          label={t("form.toAmount", { currency: toAccount?.currency ?? "" })}
          value={toAmount}
          locale={locale}
          minorUnit={toMinorUnit ?? 0}
          numberFormat={numberFormat}
          disabled={toMinorUnit == null}
          onChange={setToAmount}
        />
        {toAccount?.currency !== baseCurrency ? (
          <TransferRateField value={toFxRate} onChange={setToFxRate} label={t("form.fxRate")} />
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="transfer-description">{t("form.descriptionLabel")}</Label>
          <Input
            id="transfer-description"
            value={description}
            maxLength={200}
            placeholder={t("form.transferDescriptionPlaceholder")}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="transfer-date">{t("form.date")}</Label>
          <Input
            id="transfer-date"
            type="date"
            value={occurredOn}
            max={today ? addDays(today, 1) : undefined}
            onChange={(event) => setOccurredOn(event.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(`form.errors.${error}`)}
          </p>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={createTransfer.isPending || fromMinorUnit == null || toMinorUnit == null}
        >
          {createTransfer.isPending ? t("form.saving") : t("form.saveTransfer")}
        </Button>
      </form>
    </SheetContent>
  );
}

function TransferAccountSelect({
  accounts,
  label,
  value,
  onChange,
  placeholder,
}: {
  accounts: AccountWithBalance[];
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TransferAmountField({
  id,
  label,
  locale,
  minorUnit,
  numberFormat,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  locale: string;
  minorUnit: number;
  numberFormat: import("@/lib/money").NumberFormatPref;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange(maskMoneyInput(event.target.value, locale, minorUnit, numberFormat))
        }
      />
    </div>
  );
}

function TransferRateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(maskMoneyInput(event.target.value, "en", 8))}
      />
    </div>
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
  const { householdId, baseCurrency, numberFormat } = useHousehold();
  const { data: accounts = [] } = useAccounts(householdId);
  const { data: categories = [] } = useCategories(householdId);
  const { data: rules = [] } = useCategorizationRules(householdId);
  const { data: currencies = [] } = useCurrencies();
  const { data: members = [] } = useHouseholdMembers(householdId);
  const { data: descriptions = [] } = useTransactionDescriptions(householdId);
  const { data: effectiveRates = [] } = useFxOverrides();
  const [draft, setDraft] = useState(() =>
    makeDraft(transaction, today, lastAccountId, memberId, locale, numberFormat),
  );
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryOverridden, setCategoryOverridden] = useState(transaction !== null);
  const [fxRateOverridden, setFxRateOverridden] = useState(transaction !== null);
  const amountRef = useRef<HTMLInputElement>(null);
  const selectedAccount = accounts.find((account) => account.id === draft.accountId) ?? null;
  const minorUnit = findMinorUnit(currencies, draft.currency || null);
  const isForeignCurrency = !!draft.currency && !!baseCurrency && draft.currency !== baseCurrency;
  const rateQuery = useFxRateOn(
    householdId,
    draft.occurredOn,
    draft.currency || null,
    baseCurrency,
    isForeignCurrency,
  );
  const { create, update, remove } = useTransactionMutations(householdId, memberId);
  const { connectionState, queueTransaction } = useOfflineQueue();
  const pending = create.isPending || update.isPending || remove.isPending;
  const categoryKind = draft.isExpense ? "expense" : "income";
  const usableAccounts = accounts.filter((account) => !account.is_archived);
  const usableCategories = categories.filter(
    (category) => !category.is_archived && category.kind === categoryKind,
  );
  const effectiveRate = effectiveRates.find((rate) => rate.code === draft.currency);
  const isTransfer = transaction?.transfer_group_id != null;

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
      const categoryId = matchCategory(draft.description, rules, draft.accountId || null);
      const category = categories.find((item) => item.id === categoryId);
      const nextCategoryId =
        category?.kind === (draft.isExpense ? "expense" : "income") ? categoryId : null;
      if (draft.categoryId !== nextCategoryId) {
        setDraft((current) => ({ ...current, categoryId: nextCategoryId }));
      }
    }
  }, [
    categories,
    categoryOverridden,
    draft.accountId,
    draft.categoryId,
    draft.description,
    draft.isExpense,
    rules,
  ]);

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
    const amount = parseMoneyInput(draft.amount, locale, numberFormat);
    const fxRate = Number(draft.fxRate);
    if (!description || description.length > 200) return setError("description");
    if (!draft.accountId) return setError("account");
    if (amount == null || amount === 0) return setError("amount");
    if (!draft.currency || !Number.isFinite(fxRate) || fxRate <= 0) return setError("rate");
    if (!draft.occurredOn || (today && draft.occurredOn > addDays(today, 1)))
      return setError("date");
    if (minorUnit == null) return setError("amount");

    const input = {
      account_id: draft.accountId,
      amount: draft.isExpense
        ? -roundToMinorUnit(amount, minorUnit)
        : roundToMinorUnit(amount, minorUnit),
      category_id: draft.categoryId,
      currency: draft.currency,
      description,
      fx_rate: fxRate,
      notes: draft.notes.trim() || null,
      occurred_on: draft.occurredOn,
      spent_by: draft.spentBy,
    };

    const queuedInput =
      !transaction && householdId && memberId
        ? {
            ...input,
            id: crypto.randomUUID(),
            household_id: householdId,
            entered_by: memberId,
          }
        : null;

    try {
      if (transaction) await update.mutateAsync({ id: transaction.id, ...input });
      else if (connectionState === "offline") {
        if (!queuedInput) return setError("generic");
        await queueTransaction(queuedInput);
      } else {
        if (!queuedInput) return setError("generic");
        await create.mutateAsync(queuedInput);
      }
      localStorage.setItem(LAST_ACCOUNT_STORAGE_KEY, draft.accountId);
      onClose();
    } catch (submitError) {
      if (!transaction && queuedInput && isTransientWriteError(submitError)) {
        try {
          await queueTransaction(queuedInput);
          localStorage.setItem(LAST_ACCOUNT_STORAGE_KEY, draft.accountId);
          onClose();
          return;
        } catch {
          setError("generic");
          return;
        }
      }
      setError("generic");
    }
  }

  async function handleDelete() {
    if (!transaction) return;
    setError(null);
    if (!window.confirm(t("form.confirmDelete", { description: transaction.description }))) return;
    try {
      await remove.mutateAsync(transaction.id);
      onClose();
    } catch {
      setError("generic");
    }
  }

  async function handleDuplicate() {
    if (!transaction) return;
    setError(null);
    const amount = parseMoneyInput(draft.amount, locale, numberFormat);
    const fxRate = Number(draft.fxRate);
    if (
      amount == null ||
      amount === 0 ||
      !draft.accountId ||
      !draft.currency ||
      !Number.isFinite(fxRate) ||
      minorUnit == null
    ) {
      return setError("generic");
    }
    try {
      await create.mutateAsync({
        account_id: draft.accountId,
        amount: draft.isExpense
          ? -roundToMinorUnit(amount, minorUnit)
          : roundToMinorUnit(amount, minorUnit),
        category_id: draft.categoryId,
        currency: draft.currency,
        description: draft.description.trim(),
        fx_rate: fxRate,
        notes: draft.notes.trim() || null,
        occurred_on: draft.occurredOn,
        spent_by: draft.spentBy,
      });
      onClose();
    } catch {
      setError("generic");
    }
  }

  if (isTransfer && transaction) {
    return (
      <SheetContent side="bottom" className={ENTRY_SHEET_CLASS_NAME}>
        <SheetHeader className="border-b px-6 pb-5 pt-6">
          <SheetTitle className="text-2xl font-black tracking-tight">
            {t("form.transferTitle")}
          </SheetTitle>
          <SheetDescription>{t("form.errors.transferReadOnly")}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-6 pb-8 pt-2">
          <div className="rounded-2xl bg-secondary p-4">
            <p className="text-sm text-muted-foreground">{t("form.descriptionLabel")}</p>
            <p className="mt-1 font-semibold">{transaction.description}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border p-4">
              <p className="text-sm text-muted-foreground">{t("form.account")}</p>
              <p className="mt-1 font-semibold">{selectedAccount?.name}</p>
            </div>
            <div className="rounded-2xl border p-4 text-right">
              <p className="text-sm text-muted-foreground">{t("form.amount")}</p>
              <p className="mt-1 font-semibold tabular-nums">
                {formatSignedMoney(transaction.amount, transaction.currency, locale, numberFormat)}
              </p>
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {t(`form.errors.${error}`)}
            </p>
          ) : null}
          <Button
            type="button"
            variant="destructive"
            className="w-full"
            onClick={handleDelete}
            disabled={pending}
          >
            {pending ? t("form.saving") : t("form.delete")}
          </Button>
        </div>
      </SheetContent>
    );
  }

  return (
    <SheetContent side="bottom" className={ENTRY_SHEET_CLASS_NAME}>
      <SheetHeader className="border-b px-6 pb-5 pt-6">
        <div className="flex items-center justify-between gap-2 pr-6">
          <SheetTitle className="text-2xl font-black tracking-tight">
            {transaction ? t("form.editTitle") : t("form.title")}
          </SheetTitle>
          <HelpButton article="who-spent-vs-who-typed" />
        </div>
        <SheetDescription>{t("form.description")}</SheetDescription>
      </SheetHeader>
      <form onSubmit={handleSubmit} className="space-y-5 px-6 pb-8 pt-2">
        <div className="grid grid-cols-2 rounded-full bg-secondary p-1">
          <Button
            type="button"
            variant={draft.isExpense ? "default" : "ghost"}
            className="rounded-full"
            onClick={() =>
              setDraft((current) => ({ ...current, isExpense: true, categoryId: null }))
            }
          >
            {t("form.expense")}
          </Button>
          <Button
            type="button"
            variant={!draft.isExpense ? "default" : "ghost"}
            className="rounded-full"
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
            className="h-16 rounded-2xl border-0 bg-secondary px-5 text-right text-4xl font-black tabular-nums shadow-none"
          />
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-secondary p-2">
            {PAD_KEYS.map((key) => (
              <Button
                key={key}
                type="button"
                variant="ghost"
                className="h-12 rounded-xl text-lg hover:bg-background"
                aria-label={key === "backspace" ? t("form.backspace") : key}
                disabled={minorUnit == null}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    amount: appendMoneyPadInput(
                      current.amount,
                      key,
                      locale,
                      minorUnit ?? 0,
                      numberFormat,
                    ),
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
          <Button
            type="submit"
            className="flex-1"
            disabled={pending || !selectedAccount || minorUnit == null}
          >
            {pending ? t("form.saving") : t("form.save")}
          </Button>
          {transaction ? (
            <>
              {transaction.transfer_group_id === null ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDuplicate}
                  disabled={pending}
                >
                  {t("form.duplicate")}
                </Button>
              ) : null}
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={pending}>
                {t("form.delete")}
              </Button>
            </>
          ) : null}
        </div>
      </form>
    </SheetContent>
  );
}
