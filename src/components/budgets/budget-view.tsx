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
        remaining: -(transaction.base_amount ?? 0),
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
  const hasBudgets = (statusQuery.data?.length ?? 0) > 0;
  const loading = statusQuery.isLoading || spendingQuery.isLoading;
  const error = statusQuery.isError || spendingQuery.isError;

  if (loading)
    return (
      <main className="mx-auto w-full max-w-2xl space-y-4 p-6">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-48 w-full" />
      </main>
    );
  if (error)
    return (
      <main className="mx-auto w-full max-w-2xl space-y-3 p-6">
        <p role="alert" className="text-sm text-destructive">
          {t("loadError")}
        </p>
        <Button
          variant="outline"
          onClick={() => void Promise.all([statusQuery.refetch(), spendingQuery.refetch()])}
        >
          {t("retry")}
        </Button>
      </main>
    );

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("previousMonth")}
          onClick={() => setPeriodMonth(moveMonth(periodMonth, -1))}
        >
          <ChevronLeft />
        </Button>
        <h1 className="text-center text-xl font-semibold capitalize">
          {monthLabel(periodMonth, locale)}
        </h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("nextMonth")}
          onClick={() => setPeriodMonth(moveMonth(periodMonth, 1))}
        >
          <ChevronRight />
        </Button>
      </header>
      <div className="flex rounded-lg border p-1" role="group" aria-label={t("scopeLabel")}>
        {(["household", "mine"] as const).map((value) => (
          <Button
            key={value}
            className="flex-1"
            size="sm"
            variant={scope === value ? "default" : "ghost"}
            onClick={() => setScope(value)}
          >
            {t(`scope.${value}`)}
          </Button>
        ))}
      </div>
      <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
        {t("sortLabel")}
        <select
          className="bg-transparent text-right"
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
        >
          <option value="spent">{t("sort.spent")}</option>
          <option value="remaining">{t("sort.remaining")}</option>
          <option value="name">{t("sort.name")}</option>
        </select>
      </label>
      <section className="rounded-xl border p-5 text-center">
        <Donut rows={rows} total={totalSpent} />
        <p className="mt-4 text-sm text-muted-foreground">{t("spentLabel")}</p>
        <p className="text-3xl font-semibold">
          {formatMoney(totalSpent, baseCurrency ?? "USD", locale)}
        </p>
        {scope === "household" ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("visibleToYou")}</p>
        ) : null}
      </section>
      {!hasBudgets && previousDrafts.length > 0 ? (
        <Button className="w-full" variant="outline" onClick={() => setCopyOpen(true)}>
          <Copy />
          {t("copyPrevious", { month: monthLabel(moveMonth(periodMonth, -1), locale) })}
        </Button>
      ) : null}
      {rows.length === 0 ? (
        <section className="rounded-lg border border-dashed p-8 text-center">
          <PieChart className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 font-medium">{t("empty.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("empty.description")}</p>
        </section>
      ) : (
        <ul className="overflow-hidden rounded-lg border divide-y">
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
    </main>
  );
}

function Donut({ rows, total }: { rows: readonly BudgetRow[]; total: number }) {
  const t = useTranslations("budget");
  const slices = rows.filter((row) => row.spent > 0).slice(0, 8);
  const background = slices.length
    ? `conic-gradient(${slices
        .reduce<{ end: number; parts: string[] }>(
          (result, row) => {
            const start = result.end;
            const end = start + (row.spent / total) * 100;
            result.parts.push(`${row.color} ${start}% ${end}%`);
            result.end = end;
            return result;
          },
          { end: 0, parts: [] },
        )
        .parts.join(", ")})`
    : "conic-gradient(var(--muted) 0 100%)";
  return (
    <div
      className="mx-auto grid size-44 place-items-center rounded-full"
      style={{ background }}
      aria-label={t("chartAria", { total })}
    >
      <div className="grid size-28 place-items-center rounded-full bg-background text-sm text-muted-foreground">
        {t("chartCenter")}
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
  const href = `/transactions?categories=${row.categoryId}&start=${periodMonth}&end=${monthEnd(periodMonth)}&type=expense`;
  return (
    <li>
      <Link href={href} className="block p-4 transition-colors hover:bg-muted/50">
        <div className="flex gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full"
            style={{ backgroundColor: row.color }}
            aria-hidden
          >
            {row.icon ?? "•"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                {row.merchants.length ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {row.merchants.join(" · ")}
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-medium">{formatMoney(row.spent, currency, locale)}</p>
                <p
                  className={cn(
                    "text-xs",
                    overBudget ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {overBudget
                    ? t("overBy", {
                        amount: formatMoney(Math.abs(row.remaining), currency, locale),
                      })
                    : t("left", { amount: formatMoney(row.remaining, currency, locale) })}
                </p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", overBudget ? "bg-destructive" : "bg-primary")}
                style={{ width: `${progress}%` }}
              />
            </div>
            {row.amount === 0 ? (
              <p className="mt-2 text-xs text-destructive">{t("noBudget")}</p>
            ) : null}
          </div>
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", {
              source: monthLabel(sourceMonth, locale),
              target: monthLabel(periodMonth, locale),
            })}
          </DialogDescription>
        </DialogHeader>
        <Label>
          {t("adjustment")}
          <Input
            className="mt-1"
            type="number"
            value={adjustment}
            onChange={(event) => updateAdjustment(event.target.value)}
          />
        </Label>
        <div className="max-h-72 space-y-3 overflow-y-auto">
          {drafts.map((draft) => (
            <Label key={draft.categoryId} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">{draft.name}</span>
              <Input
                className="w-32"
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
            </Label>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
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
