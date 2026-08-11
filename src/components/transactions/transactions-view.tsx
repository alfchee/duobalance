"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftRight,
  CalendarDays,
  ChevronDown,
  Filter,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdMembers } from "@/hooks/useHouseholdMembers";
import { useTransactionSummary, useTransactions } from "@/hooks/useTransactions";
import { displayBalance } from "@/lib/accounts";
import { formatUpdatedAgo } from "@/lib/balances";
import { formatMoney, formatSignedMoney } from "@/lib/money";
import {
  activityRoute,
  applyActivityFilterUpdates,
  clearActivityFilterUpdates,
  hasActivityFilters,
  readActivityFilters,
  serializeActivityFilterIds,
  type ActivityFilterUpdates,
} from "@/lib/transactions/activity-filters";
import { groupActivityByDay, summarizeActivity } from "@/lib/transactions/activity-model";
import { useAccountsUiStore } from "@/store/accounts";
import { useTransactionsUiStore } from "@/store/transactions";

function selectedValues(event: React.ChangeEvent<HTMLSelectElement>): string[] {
  return Array.from(event.currentTarget.selectedOptions, (option) => option.value);
}

function dateLabel(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(
    new Date(`${date}T00:00:00`),
  );
}

export function TransactionsView({ accountId }: { accountId?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("transactions");
  const { householdId, baseCurrency } = useHousehold();
  const accountDetailId = accountId ?? searchParams.get("accountDetail");
  const filters = readActivityFilters(searchParams, accountDetailId);
  const transactionsQuery = useTransactions(householdId, filters);
  const transactions = transactionsQuery.data?.pages.flat() ?? [];
  const { data: summaryTransactions = [] } = useTransactionSummary(householdId, filters);
  const { data: accounts = [] } = useAccounts(householdId);
  const { data: categories = [] } = useCategories(householdId);
  const { data: members = [] } = useHouseholdMembers(householdId);
  const openCreate = useTransactionsUiStore((state) => state.openCreate);
  const openEdit = useTransactionsUiStore((state) => state.openEdit);
  const openAccountEdit = useAccountsUiStore((state) => state.openEdit);
  const openManualBalance = useAccountsUiStore((state) => state.openManualBalance);
  const [searchInput, setSearchInput] = useState(filters.query);
  const [filtersOpen, setFiltersOpen] = useState(hasActivityFilters(filters));
  const detailAccount = accounts.find((account) => account.id === accountDetailId);
  const balanceUpdated = formatUpdatedAgo(
    detailAccount?.balance_updated_at ?? null,
    new Date(),
    locale,
  );

  const summary = summarizeActivity(summaryTransactions);
  const hasFilters = hasActivityFilters(filters);

  const updateFilters = useCallback(
    (updates: ActivityFilterUpdates) => {
      router.replace(activityRoute(accountId, applyActivityFilterUpdates(searchParams, updates)));
    },
    [accountId, router, searchParams],
  );

  useEffect(() => {
    setSearchInput(filters.query);
  }, [filters.query]);

  useEffect(() => {
    if (searchInput === filters.query) return;
    const timeout = window.setTimeout(() => updateFilters({ q: searchInput || null }), 300);
    return () => window.clearTimeout(timeout);
  }, [filters.query, searchInput, updateFilters]);

  if (transactionsQuery.isLoading)
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-28 animate-pulse rounded-4xl bg-muted" />
        <div className="h-16 animate-pulse rounded-2xl bg-muted" />
        <div className="h-40 animate-pulse rounded-3xl bg-muted" />
        <span className="sr-only">{t("loading")}</span>
      </div>
    );
  if (transactionsQuery.isError)
    return (
      <div className="rounded-4xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="font-semibold text-destructive">{t("loadError")}</p>
        <Button variant="outline" onClick={() => void transactionsQuery.refetch()}>
          {t("retry")}
        </Button>
      </div>
    );

  return (
    <div className="space-y-6">
      {detailAccount ? (
        <div className="rounded-4xl border bg-background p-5 shadow-ring sm:p-6">
          <p className="text-xl font-black tracking-tight">{detailAccount.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {[detailAccount.institution, detailAccount.currency].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-5 text-3xl font-black tracking-tight tabular-nums">
            {formatMoney(displayBalance(detailAccount), detailAccount.currency, locale)}
          </p>
          <p className="text-xs text-muted-foreground">
            {balanceUpdated.never
              ? t("accountDetail.neverUpdated")
              : t("accountDetail.updated", { when: balanceUpdated.text })}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openAccountEdit(detailAccount)}
            >
              {t("accountDetail.edit")}
            </Button>
            {detailAccount.balance_mode === "manual" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openManualBalance(detailAccount)}
              >
                {t("accountDetail.updateBalance")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => updateFilters({ accountDetail: null })}
            >
              {t("accountDetail.allTransactions")}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t("summary.count")}
          </p>
          <h2 className="mt-1 text-3xl font-black tracking-tight">{t("title")}</h2>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("newTransfer")}
            onClick={() => openCreate("transfer")}
          >
            <ArrowLeftRight />
          </Button>
          <Button onClick={() => openCreate()}>
            <Plus />
            {t("new")}
          </Button>
        </div>
      </div>
      <div className="rounded-4xl border bg-background p-3 shadow-ring sm:p-4">
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-secondary px-4 py-3 text-sm">
            <Search className="size-4" />
            <input
              className="min-w-0 flex-1 bg-transparent outline-none"
              value={searchInput}
              placeholder={t("search")}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("clearFilters")}
            disabled={!hasFilters}
            onClick={() => updateFilters(clearActivityFilterUpdates())}
          >
            <X />
          </Button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-controls="activity-filters"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <Filter />
            {filtersOpen ? t("hideFilters") : t("showFilters")}
            <ChevronDown
              className={filtersOpen ? "rotate-180 transition-transform" : "transition-transform"}
            />
          </Button>
          {hasFilters ? (
            <span className="text-xs font-semibold text-muted-foreground">
              {t("filtersActive")}
            </span>
          ) : null}
        </div>
        <div
          id="activity-filters"
          hidden={!filtersOpen}
          className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
        >
          <label className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2.5 text-sm font-semibold">
            <Filter className="size-4 shrink-0" />
            <select
              className="min-w-0 flex-1 bg-transparent"
              value={filters.type}
              onChange={(event) =>
                updateFilters({ type: event.target.value === "all" ? null : event.target.value })
              }
            >
              <option value="all">{t("filters.allTypes")}</option>
              <option value="expense">{t("filters.expense")}</option>
              <option value="income">{t("filters.income")}</option>
              <option value="transfer">{t("filters.transfer")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2.5 text-sm font-semibold">
            <SlidersHorizontal className="size-4 shrink-0" />
            <select
              aria-label={t("filters.account")}
              className="min-w-0 flex-1 bg-transparent"
              value={filters.accountIds}
              multiple
              disabled={accountDetailId !== null}
              onChange={(event) => {
                const accountIds = selectedValues(event);
                updateFilters({ accounts: serializeActivityFilterIds(accountIds) });
              }}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2.5 text-sm font-semibold">
            <SlidersHorizontal className="size-4 shrink-0" />
            <select
              aria-label={t("filters.category")}
              className="min-w-0 flex-1 bg-transparent"
              value={filters.categoryIds}
              multiple
              onChange={(event) => {
                const categoryIds = selectedValues(event);
                updateFilters({ categories: serializeActivityFilterIds(categoryIds) });
              }}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2.5 text-sm font-semibold">
            <SlidersHorizontal className="size-4 shrink-0" />
            <select
              aria-label={t("filters.member")}
              className="min-w-0 flex-1 bg-transparent"
              value={filters.memberId ?? ""}
              onChange={(event) => updateFilters({ member: event.target.value || null })}
            >
              <option value="">{t("filters.allMembers")}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2.5 text-sm font-semibold">
            <CalendarDays className="size-4 shrink-0" />
            <input
              aria-label={t("filters.startDate")}
              className="min-w-0 flex-1 bg-transparent"
              type="date"
              value={filters.startDate ?? ""}
              onChange={(event) => updateFilters({ start: event.target.value || null })}
            />
          </label>
          <label className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2.5 text-sm font-semibold">
            <CalendarDays className="size-4 shrink-0" />
            <input
              aria-label={t("filters.endDate")}
              className="min-w-0 flex-1 bg-transparent"
              type="date"
              value={filters.endDate ?? ""}
              onChange={(event) => updateFilters({ end: event.target.value || null })}
            />
          </label>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-4xl bg-border sm:grid-cols-4">
        <div className="bg-secondary p-4 text-center">
          <p>{t("summary.count")}</p>
          <strong>{summary.count}</strong>
        </div>
        <div className="bg-secondary p-4 text-center">
          <p>{t("summary.inflow")}</p>
          <strong>{formatMoney(summary.inflow, baseCurrency ?? "USD", locale)}</strong>
        </div>
        <div className="bg-secondary p-4 text-center">
          <p>{t("summary.outflow")}</p>
          <strong>{formatMoney(summary.outflow, baseCurrency ?? "USD", locale)}</strong>
        </div>
        <div className="bg-secondary p-4 text-center">
          <p>{t("summary.net")}</p>
          <strong>
            {formatSignedMoney(summary.inflow - summary.outflow, baseCurrency ?? "USD", locale)}
          </strong>
        </div>
      </div>
      {transactions.length === 0 ? (
        <div className="rounded-4xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {hasFilters ? t("noResults") : t("empty")}
        </div>
      ) : (
        <div className="space-y-6">
          {groupActivityByDay(transactions).map(
            ({ date, subtotal, transactions: dayTransactions }) => {
              return (
                <section
                  key={date}
                  className="overflow-hidden rounded-4xl border bg-background shadow-ring"
                >
                  <header className="flex justify-between bg-secondary px-5 py-3 text-xs font-bold uppercase tracking-wider">
                    <span>{dateLabel(date, locale)}</span>
                    <span>{formatSignedMoney(subtotal, baseCurrency ?? "USD", locale)}</span>
                  </header>
                  <ul className="divide-y">
                    {dayTransactions.map((transaction) => {
                      const account = accounts.find((item) => item.id === transaction.account_id);
                      const category = categories.find(
                        (item) => item.id === transaction.category_id,
                      );
                      const transfer = transaction.transfer_group_id !== null;
                      return (
                        <li key={transaction.id} className="flex items-center gap-3 p-4 sm:px-5">
                          {transfer ? (
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary">
                              <ArrowLeftRight className="size-4 text-muted-foreground" />
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => openEdit(transaction)}
                          >
                            <p className="truncate font-semibold">
                              {transfer ? t("transfer") : transaction.description}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {[transaction.occurred_on, account?.name, category?.name]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </button>
                          <p
                            className={`shrink-0 text-right tabular-nums ${
                              transaction.amount < 0
                                ? "font-semibold text-destructive"
                                : "font-semibold text-success"
                            }`}
                          >
                            {formatSignedMoney(transaction.amount, transaction.currency, locale)}
                            {transaction.currency !== baseCurrency &&
                            transaction.base_amount !== null ? (
                              <span className="block text-xs font-normal text-muted-foreground">
                                {formatSignedMoney(
                                  transaction.base_amount,
                                  baseCurrency ?? "USD",
                                  locale,
                                )}
                              </span>
                            ) : null}
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("edit", { description: transaction.description })}
                            onClick={() => openEdit(transaction)}
                          >
                            <Pencil />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            },
          )}
        </div>
      )}
      {transactionsQuery.hasNextPage ? (
        <Button
          className="w-full"
          variant="outline"
          disabled={transactionsQuery.isFetchingNextPage}
          onClick={() => void transactionsQuery.fetchNextPage()}
        >
          {transactionsQuery.isFetchingNextPage ? t("loading") : t("loadMore")}
        </Button>
      ) : null}
    </div>
  );
}
