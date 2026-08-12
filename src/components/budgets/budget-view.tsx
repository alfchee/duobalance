"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, PieChart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { BudgetCategoryList } from "@/components/budgets/budget-category-list";
import { BudgetHeader } from "@/components/budgets/budget-header";
import { BudgetRing } from "@/components/budgets/budget-ring";
import { CopyBudgetsDialog } from "@/components/budgets/copy-budgets-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudgetMutations, useBudgetSpending, useBudgetStatus } from "@/hooks/useBudgets";
import { useCategories } from "@/hooks/useCategories";
import { useCurrencies } from "@/hooks/useCurrencies";
import { useHousehold } from "@/hooks/useHousehold";
import {
  calculateBudgetSummary,
  createCopyBudgetInputs,
  createBudgetRows,
  createCopyBudgetDrafts,
  getBudgetMonthLabel,
  moveBudgetMonth,
} from "@/lib/budgets/model";
import { startOfMonthInHousehold } from "@/lib/dates";
import { useBudgetUiStore } from "@/store/budget";

export function BudgetView() {
  const locale = useLocale();
  const t = useTranslations("budget");
  const copyDialogT = useTranslations("budget.copyDialog");
  const { baseCurrency, householdId, memberId, timezone } = useHousehold();
  const { copyOpen, scope, setCopyOpen, setScope, setSort, sort } = useBudgetUiStore();
  const [periodMonth, setPeriodMonth] = useState(() => startOfMonthInHousehold(timezone ?? "UTC"));
  const ownerMemberId = scope === "mine" ? memberId : null;
  const statusQuery = useBudgetStatus(householdId, periodMonth, ownerMemberId);
  const spendingQuery = useBudgetSpending(householdId, periodMonth, ownerMemberId);
  const previousStatusQuery = useBudgetStatus(
    householdId,
    moveBudgetMonth(periodMonth, -1),
    ownerMemberId,
  );
  const { data: categories = [] } = useCategories(householdId);
  const { data: currencies = [] } = useCurrencies();
  const { copy } = useBudgetMutations(householdId);

  useEffect(() => {
    if (timezone) setPeriodMonth(startOfMonthInHousehold(timezone));
  }, [timezone]);

  const currency = baseCurrency ?? "USD";
  const minorUnit = currencies.find((item) => item.code === baseCurrency)?.minor_unit ?? 2;
  const rows = useMemo(
    () =>
      createBudgetRows({
        budgetStatus: statusQuery.data ?? [],
        categories,
        sort,
        spending: spendingQuery.data ?? [],
        unknownCategory: t("unknownCategory"),
      }),
    [categories, sort, spendingQuery.data, statusQuery.data, t],
  );
  const previousDrafts = useMemo(
    () => createCopyBudgetDrafts(previousStatusQuery.data ?? [], categories, t("unknownCategory")),
    [categories, previousStatusQuery.data, t],
  );
  const { spent, totalBudget } = useMemo(() => calculateBudgetSummary(rows), [rows]);
  const hasBudgets = (statusQuery.data?.length ?? 0) > 0;
  const loading = statusQuery.isLoading || spendingQuery.isLoading;
  const error = statusQuery.isError || spendingQuery.isError;
  const previousMonth = moveBudgetMonth(periodMonth, -1);
  const monthLabel = getBudgetMonthLabel(periodMonth, locale);

  if (loading) return <BudgetViewSkeleton />;
  if (error)
    return (
      <BudgetViewError
        message={t("loadError")}
        retryLabel={t("retry")}
        onRetry={() => void Promise.all([statusQuery.refetch(), spendingQuery.refetch()])}
      />
    );

  return (
    <div className="flex flex-col gap-8">
      <BudgetHeader
        monthLabel={monthLabel}
        scope={scope}
        sort={sort}
        onPreviousMonth={() => setPeriodMonth(moveBudgetMonth(periodMonth, -1))}
        onNextMonth={() => setPeriodMonth(moveBudgetMonth(periodMonth, 1))}
        onScopeChange={setScope}
        onSortChange={setSort}
        translations={{
          household: t("scope.household"),
          mine: t("scope.mine"),
          nextMonth: t("nextMonth"),
          previousMonth: t("previousMonth"),
          scopeLabel: t("scopeLabel"),
          sortLabel: t("sortLabel"),
          sortName: t("sort.name"),
          sortRemaining: t("sort.remaining"),
          sortSpent: t("sort.spent"),
          title: t("title"),
        }}
      />
      <section className="rounded-[24px] bg-secondary/70 p-10 text-center sm:p-14">
        <BudgetRing
          ariaLabel={t("chartAria", { total: spent.toString() })}
          chartCenter={t("chartCenter")}
          currency={currency}
          leftLabel={t("left", { amount: "" }).trim()}
          locale={locale}
          ofBudget={(values) => t("ofBudget", values)}
          spent={spent}
          totalBudget={totalBudget}
        />
      </section>
      {rows.length === 0 ? (
        <BudgetEmptyState title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <BudgetCategoryList
          currency={currency}
          locale={locale}
          periodMonth={periodMonth}
          rows={rows}
          visibleToHousehold={scope === "household"}
          translations={{
            categories: t("categories"),
            noBudget: t("noBudget"),
            overBy: (values) => t("overBy", values),
            percentUsed: (values) => t("percentUsed", values),
            visibleToYou: t("visibleToYou"),
          }}
        />
      )}
      {!hasBudgets && previousDrafts.length > 0 ? (
        <Button
          className="w-full rounded-full py-6 text-base"
          variant="secondary"
          onClick={() => setCopyOpen(true)}
        >
          <Copy className="size-5" />
          {t("copyPrevious", { month: getBudgetMonthLabel(previousMonth, locale) })}
        </Button>
      ) : null}
      <CopyBudgetsDialog
        drafts={previousDrafts}
        locale={locale}
        minorUnit={minorUnit}
        open={copyOpen}
        pending={copy.isPending}
        onClose={() => setCopyOpen(false)}
        onCopy={async (drafts) => {
          await copy.mutateAsync(createCopyBudgetInputs(drafts, ownerMemberId, periodMonth));
          setCopyOpen(false);
        }}
        translations={{
          adjustment: copyDialogT("adjustment"),
          cancel: copyDialogT("cancel"),
          confirm: copyDialogT("confirm"),
          copying: copyDialogT("copying"),
          description: copyDialogT("description", {
            source: getBudgetMonthLabel(previousMonth, locale),
            target: monthLabel,
          }),
          error: copyDialogT("error"),
          title: copyDialogT("title"),
        }}
      />
    </div>
  );
}

function BudgetViewSkeleton() {
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
}

function BudgetViewError({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry: () => void;
  retryLabel: string;
}) {
  return (
    <div className="space-y-3 rounded-[40px] border bg-background p-6 text-center shadow-ring">
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
      <Button variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

function BudgetEmptyState({ description, title }: { description: string; title: string }) {
  return (
    <section className="rounded-[40px] border border-dashed bg-background p-10 text-center shadow-ring">
      <PieChart className="mx-auto size-12 text-muted-foreground" />
      <h2 className="mt-5 text-xl font-black tracking-tight">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </section>
  );
}
