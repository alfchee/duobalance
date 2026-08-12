"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Copy, PieChart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useBudgetMutations, useBudgetSpending, useBudgetStatus } from "@/hooks/useBudgets";
import { useCategories } from "@/hooks/useCategories";
import { useCurrencies } from "@/hooks/useCurrencies";
import { useHousehold } from "@/hooks/useHousehold";
import { startOfMonthInHousehold } from "@/lib/dates";
import { formatMoney, parseMoneyInput, roundToMinorUnit } from "@/lib/money";
import { cn } from "@/lib/utils";

type Scope = "household" | "mine";
type Sort = "name" | "remaining" | "spent";

type BudgetRow = {
  amount: number;
  categoryId: string;
  color: string;
  icon: string | null;
  id: string | null;
  merchants: string[];
  name: string;
  remaining: number;
  spent: number;
};

type CopyDraft = {
  amount: number;
  categoryId: string;
  name: string;
  rollover: boolean;
};

function moveMonth(periodMonth: string, offset: number): string {
  const date = new Date(`${periodMonth}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}

function monthEnd(periodMonth: string): string {
  const date = new Date(`${periodMonth}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function monthLabel(periodMonth: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${periodMonth}T00:00:00Z`));
}

export function BudgetView() {
  const locale = useLocale();
  const t = useTranslations("budget");
  const { baseCurrency, householdId, memberId, timezone } = useHousehold();
  const [scope, setScope] = useState<Scope>("household");
  const [periodMonth, setPeriodMonth] = useState(() => startOfMonthInHousehold(timezone ?? "UTC"));
  const [sort, setSort] = useState<Sort>("spent");
  const ownerMemberId = scope === "mine" ? memberId : null;
  const statusQuery = useBudgetStatus(householdId, periodMonth, ownerMemberId);
  const spendingQuery = useBudgetSpending(householdId, periodMonth, ownerMemberId);
  const previousStatusQuery = useBudgetStatus(
    householdId,
    moveMonth(periodMonth, -1),
    ownerMemberId,
  );
  const { data: categories = [] } = useCategories(householdId);
  const { data: currencies = [] } = useCurrencies();
  const { copy } = useBudgetMutations(householdId);
  const [copyOpen, setCopyOpen] = useState(false);

  useEffect(() => {
    if (timezone) setPeriodMonth(startOfMonthInHousehold(timezone));
  }, [timezone]);

  const minorUnit = currencies.find((currency) => currency.code === baseCurrency)?.minor_unit ?? 2;
  const rows = useMemo<BudgetRow[]>(() => {
    const rowsByCategory = new Map<string, BudgetRow>();
    for (const budget of statusQuery.data ?? []) {
      if (!budget.category_id) continue;
      const category = categories.find((item) => item.id === budget.category_id);
      rowsByCategory.set(budget.category_id, {
        amount: budget.amount ?? 0,
        categoryId: budget.category_id,
        color: category?.color_hex ?? "#64748B",
        icon: category?.icon ?? null,
        id: budget.id,
        merchants: [],
        name: category?.name ?? t("unknownCategory"),
        remaining: budget.remaining ?? 0,
        spent: budget.spent ?? 0,
      });
    }
    for (const transaction of spendingQuery.data ?? []) {
      if (!transaction.category_id) continue;
      const category = categories.find((item) => item.id === transaction.category_id);
      const current = rowsByCategory.get(transaction.category_id);
      const merchant = transaction.description.trim();
      if (current?.id === null) {
        current.spent += Math.abs(transaction.base_amount ?? 0);
        current.remaining -= Math.abs(transaction.base_amount ?? 0);
        if (merchant && !current.merchants.includes(merchant) && current.merchants.length < 2)
          current.merchants.push(merchant);
        continue;
      }
      if (current) {
        if (merchant && !current.merchants.includes(merchant) && current.merchants.length < 2)
          current.merchants.push(merchant);
        continue;
      }
      rowsByCategory.set(transaction.category_id, {
        amount: 0,
        categoryId: transaction.category_id,
        color: category?.color_hex ?? "#64748B",
        icon: category?.icon ?? null,
        id: null,
        merchants: merchant ? [merchant] : [],
        name: category?.name ?? t("unknownCategory"),
        remaining: -Math.abs(transaction.base_amount ?? 0),
        spent: Math.abs(transaction.base_amount ?? 0),
      });
    }
    return [...rowsByCategory.values()].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "remaining") return a.remaining - b.remaining || b.spent - a.spent;
      return b.spent - a.spent || a.name.localeCompare(b.name);
    });
  }, [categories, sort, spendingQuery.data, statusQuery.data, t]);

  const previousDrafts = useMemo<CopyDraft[]>(
    () =>
      (previousStatusQuery.data ?? [])
        .filter((budget) => budget.category_id && budget.amount !== null)
        .map((budget) => ({
          amount: budget.amount ?? 0,
          categoryId: budget.category_id!,
          name:
            categories.find((category) => category.id === budget.category_id)?.name ??
            t("unknownCategory"),
          rollover: budget.rollover ?? false,
        })),
    [categories, previousStatusQuery.data, t],
  );
  const totalSpent = rows.reduce((total, row) => total + row.spent, 0);
  const totalBudget = rows.reduce((total, row) => total + Math.max(row.amount, 0), 0);
  const hasBudgets = (statusQuery.data?.length ?? 0) > 0;
  const loading = statusQuery.isLoading || spendingQuery.isLoading;
  const error = statusQuery.isError || spendingQuery.isError;

  if (loading)
    return (
      <div className="flex flex-col gap-8">
        <div className="space-y-6">
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="mx-auto h-11 w-full max-w-md rounded-full" />
        </div>
        <Skeleton className="h-[320px] w-full rounded-[24px]" />
        <div className="space-y-4">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-20 w-full rounded" />
          <Skeleton className="h-20 w-full rounded" />
        </div>
      </div>
    );
  if (error)
    return (
      <div className="space-y-3 rounded-[40px] border bg-background p-6 text-center shadow-ring">
        <p role="alert" className="text-sm text-destructive">
          {t("loadError")}
        </p>
        <Button
          variant="outline"
          onClick={() => void Promise.all([statusQuery.refetch(), spendingQuery.refetch()])}
        >
          {t("retry")}
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("previousMonth")}
            onClick={() => setPeriodMonth(moveMonth(periodMonth, -1))}
          >
            <ChevronLeft />
          </Button>
          <div className="flex flex-col">
            <h1 className="text-2xl font-black tracking-tight capitalize sm:text-3xl">Budget</h1>
            <p className="text-sm font-semibold text-muted-foreground">
              {monthLabel(periodMonth, locale)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("nextMonth")}
            onClick={() => setPeriodMonth(moveMonth(periodMonth, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="budget-sort">
            {t("sortLabel")}
          </label>
          <select
            id="budget-sort"
            className="rounded-full border bg-background px-4 py-2 text-sm font-semibold shadow-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
          >
            <option value="spent">{t("sort.spent")}</option>
            <option value="remaining">{t("sort.remaining")}</option>
            <option value="name">{t("sort.name")}</option>
          </select>
        </div>
      </header>
      <div
        className="mx-auto inline-flex w-full max-w-md rounded-full bg-muted p-1 text-sm"
        role="group"
        aria-label={t("scopeLabel")}
      >
        {(["household", "mine"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={scope === value}
            onClick={() => setScope(value)}
            className={cn(
              "flex-1 rounded-full px-4 py-2.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              scope === value
                ? "bg-background text-foreground shadow-ring"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`scope.${value}`)}
          </button>
        ))}
      </div>
      <section className="rounded-[24px] bg-secondary/70 p-10 text-center sm:p-14">
        <BudgetRing
          spent={totalSpent}
          totalBudget={totalBudget}
          currency={baseCurrency ?? "USD"}
          locale={locale}
        />
      </section>
      {!hasBudgets && previousDrafts.length > 0 ? (
        <Button
          className="w-full rounded-full py-6 text-base"
          variant="secondary"
          onClick={() => setCopyOpen(true)}
        >
          <Copy className="size-5" />
          {t("copyPrevious", { month: monthLabel(moveMonth(periodMonth, -1), locale) })}
        </Button>
      ) : null}
      {rows.length === 0 ? (
        <section className="rounded-[40px] border border-dashed bg-background p-10 text-center shadow-ring">
          <PieChart className="mx-auto size-12 text-muted-foreground" />
          <h2 className="mt-5 text-xl font-black tracking-tight">{t("empty.title")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("empty.description")}</p>
        </section>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex items-end justify-between border-b pb-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Categories
            </p>
            {scope === "household" ? (
              <p className="text-xs text-muted-foreground">{t("visibleToYou")}</p>
            ) : null}
          </div>
          <ul className="flex flex-col divide-y">
            {rows.map((row) => (
              <BudgetCategoryRow
                key={`${row.categoryId}-${row.id ?? "spend"}`}
                row={row}
                periodMonth={periodMonth}
                currency={baseCurrency ?? "USD"}
                locale={locale}
              />
            ))}
          </ul>
        </div>
      )}
      <CopyBudgetsDialog
        open={copyOpen}
        periodMonth={periodMonth}
        sourceMonth={moveMonth(periodMonth, -1)}
        drafts={previousDrafts}
        minorUnit={minorUnit}
        pending={copy.isPending}
        onClose={() => setCopyOpen(false)}
        onCopy={async (drafts) => {
          await copy.mutateAsync(
            drafts.map((draft) => ({
              amount: draft.amount,
              category_id: draft.categoryId,
              owner_member_id: ownerMemberId,
              period_month: periodMonth,
              rollover: draft.rollover,
            })),
          );
          setCopyOpen(false);
        }}
      />
    </div>
  );
}

function BudgetRing({
  spent,
  totalBudget,
  currency,
  locale,
}: {
  spent: number;
  totalBudget: number;
  currency: string;
  locale: string;
}) {
  const t = useTranslations("budget");
  const overBudget = totalBudget > 0 && spent > totalBudget;
  const progress = totalBudget > 0 ? Math.min(spent / totalBudget, 1) : 0;
  const circumference = 2 * Math.PI * 80;
  const dash = circumference * progress;
  const remaining = Math.max(totalBudget - spent, 0);
  return (
    <div
      className="relative mx-auto grid size-64 place-items-center"
      role="img"
      aria-label={t("chartAria", { total: formatMoney(spent, currency, locale) })}
    >
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full -rotate-90">
        <circle cx="100" cy="100" r="80" fill="none" stroke="var(--background)" strokeWidth="18" />
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke={overBudget ? "var(--destructive)" : "var(--primary)"}
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <div className="relative z-10 flex flex-col items-center">
        <p className="text-4xl font-black tracking-tight tabular-nums sm:text-5xl">
          {formatMoney(spent, currency, locale)}
        </p>
        {totalBudget > 0 ? (
          <p className="mt-1 text-sm font-semibold text-muted-foreground tabular-nums">
            of {formatMoney(totalBudget, currency, locale)} ·{" "}
            {formatMoney(remaining, currency, locale)} left
          </p>
        ) : (
          <p className="mt-1 text-sm font-semibold text-muted-foreground">{t("chartCenter")}</p>
        )}
      </div>
    </div>
  );
}

function BudgetCategoryRow({
  row,
  periodMonth,
  currency,
  locale,
}: {
  row: BudgetRow;
  periodMonth: string;
  currency: string;
  locale: string;
}) {
  const t = useTranslations("budget");
  const overBudget = row.remaining < 0 || (row.amount === 0 && row.spent > 0);
  const progress =
    row.amount > 0 ? Math.min((row.spent / row.amount) * 100, 100) : row.spent > 0 ? 100 : 0;
  const percentUsed =
    row.amount > 0 ? Math.min(Math.round((row.spent / row.amount) * 100), 100) : 0;
  const href = `/transactions?categories=${row.categoryId}&start=${periodMonth}&end=${monthEnd(periodMonth)}&type=expense`;
  return (
    <li>
      <Link
        href={href}
        className="block py-4 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-5"
      >
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{row.name}</p>
              {row.merchants.length ? (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {row.merchants.join(" · ")}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-baseline gap-1 text-lg font-semibold tabular-nums">
              <span className={overBudget ? "text-destructive" : "text-foreground"}>
                {formatMoney(row.spent, currency, locale)}
              </span>
              <span className="text-muted-foreground">/</span>
              <span className={overBudget ? "text-destructive" : "text-muted-foreground"}>
                {row.amount > 0
                  ? formatMoney(row.amount, currency, locale)
                  : formatMoney(0, currency, locale)}
              </span>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                overBudget ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          {overBudget ? (
            <p className="mt-2 text-xs font-semibold text-destructive">
              {t("overBy", {
                amount: formatMoney(Math.abs(row.remaining), currency, locale),
              })}
            </p>
          ) : row.amount === 0 ? (
            <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-destructive">
              {t("noBudget")}
            </p>
          ) : (
            <p className="mt-2 text-xs font-semibold text-muted-foreground">{percentUsed}% used</p>
          )}
        </div>
      </Link>
    </li>
  );
}

function CopyBudgetsDialog({
  open,
  periodMonth,
  sourceMonth,
  drafts: initialDrafts,
  minorUnit,
  pending,
  onClose,
  onCopy,
}: {
  open: boolean;
  periodMonth: string;
  sourceMonth: string;
  drafts: readonly CopyDraft[];
  minorUnit: number;
  pending: boolean;
  onClose: () => void;
  onCopy: (drafts: readonly CopyDraft[]) => Promise<void>;
}) {
  const locale = useLocale();
  const t = useTranslations("budget.copyDialog");
  const [drafts, setDrafts] = useState<CopyDraft[]>(() => [...initialDrafts]);
  const [adjustment, setAdjustment] = useState("0");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDrafts([...initialDrafts]);
    setAdjustment("0");
    setError(null);
  }, [initialDrafts, open]);

  const updateAdjustment = (value: string) => {
    setAdjustment(value);
    const adjustmentValue = Number(value);
    if (!Number.isFinite(adjustmentValue)) return;
    setDrafts(
      initialDrafts.map((draft) => ({
        ...draft,
        amount: roundToMinorUnit(draft.amount * (1 + adjustmentValue / 100), minorUnit),
      })),
    );
  };
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="rounded-[30px]">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-2xl font-black tracking-tight">{t("title")}</DialogTitle>
          <DialogDescription className="text-sm">
            {t("description", {
              source: monthLabel(sourceMonth, locale),
              target: monthLabel(periodMonth, locale),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t("adjustment")}
          </Label>
          <Input
            className="rounded-full text-base"
            type="number"
            value={adjustment}
            onChange={(event) => updateAdjustment(event.target.value)}
          />
        </div>
        <div className="max-h-72 space-y-3 overflow-y-auto rounded-[16px] border p-3 shadow-ring sm:p-4">
          {drafts.map((draft) => (
            <div
              key={draft.categoryId}
              className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2 sm:px-4 sm:py-3 hover:bg-secondary/50"
            >
              <span className="min-w-0 truncate font-semibold">{draft.name}</span>
              <Input
                className="w-36 rounded-full text-base tabular-nums"
                inputMode="decimal"
                value={draft.amount}
                onChange={(event) => {
                  const amount = parseMoneyInput(event.target.value, locale);
                  if (amount === null || amount < 0) return;
                  setDrafts((current) =>
                    current.map((item) =>
                      item.categoryId === draft.categoryId
                        ? { ...item, amount: roundToMinorUnit(amount, minorUnit) }
                        : item,
                    ),
                  );
                }}
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
            {t("cancel")}
          </Button>
          <Button
            className="rounded-full text-sm font-semibold"
            disabled={pending || drafts.length === 0}
            onClick={() => void onCopy(drafts).catch(() => setError(t("error")))}
          >
            {pending ? t("copying") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
