"use client";

import { Filter, Pencil, Plus, Search, ArrowLeftRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdMembers } from "@/hooks/useHouseholdMembers";
import {
  useTransactionSummary,
  useTransactions,
  type TransactionFilters,
} from "@/hooks/useTransactions";
import { displayBalance } from "@/lib/accounts";
import { formatUpdatedAgo } from "@/lib/balances";
import { formatMoney, formatSignedMoney } from "@/lib/money";
import { useAccountsUiStore } from "@/store/accounts";
import { useTransactionsUiStore } from "@/store/transactions";

const FILTER_SEPARATOR = ",";
const TRANSACTION_TYPES = ["all", "expense", "income", "transfer"] as const;

type TransactionType = (typeof TRANSACTION_TYPES)[number];

function valuesFromSearch(value: string | null): string[] {
  return value?.split(FILTER_SEPARATOR).filter(Boolean) ?? [];
}

function transactionTypeFromSearch(value: string | null): TransactionType {
  return (TRANSACTION_TYPES as readonly string[]).includes(value ?? "")
    ? (value as TransactionType)
    : "all";
}

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
  const filters: TransactionFilters = {
    accountIds: accountDetailId
      ? [accountDetailId]
      : valuesFromSearch(searchParams.get("accounts")),
    categoryIds: valuesFromSearch(searchParams.get("categories")),
    endDate: searchParams.get("end"),
    memberId: searchParams.get("member"),
    query: searchParams.get("q") ?? "",
    startDate: searchParams.get("start"),
    type: transactionTypeFromSearch(searchParams.get("type")),
  };
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
  const detailAccount = accounts.find((account) => account.id === accountDetailId);
  const balanceUpdated = formatUpdatedAgo(
    detailAccount?.balance_updated_at ?? null,
    new Date(),
    locale,
  );

  const summary = summaryTransactions.reduce(
    (totals, transaction) => {
      totals.count += 1;
      if (transaction.transfer_group_id) return totals;
      const amount = transaction.base_amount ?? 0;
      if (amount < 0) totals.outflow += Math.abs(amount);
      else totals.inflow += amount;
      return totals;
    },
    { count: 0, inflow: 0, outflow: 0 },
  );
  const hasFilters = Boolean(
    filters.query ||
    filters.startDate ||
    filters.endDate ||
    filters.accountIds.length ||
    filters.categoryIds.length ||
    filters.memberId ||
    filters.type !== "all",
  );

  function updateFilters(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    router.replace(
      `${accountId ? `/accounts/${accountId}` : "/transactions"}${next.size ? `?${next.toString()}` : ""}`,
    );
  }

  if (transactionsQuery.isLoading)
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (transactionsQuery.isError)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{t("loadError")}</p>
        <Button variant="outline" onClick={() => void transactionsQuery.refetch()}>
          {t("retry")}
        </Button>
      </div>
    );

  return (
    <div className="space-y-4">
      {detailAccount ? (
        <div className="rounded-lg border p-4">
          <p className="font-semibold">{detailAccount.name}</p>
          <p className="text-sm text-muted-foreground">
            {[detailAccount.institution, detailAccount.currency].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-2 text-lg font-medium">
            {formatMoney(displayBalance(detailAccount), detailAccount.currency, locale)}
          </p>
          <p className="text-xs text-muted-foreground">
            {balanceUpdated.never
              ? t("accountDetail.neverUpdated")
              : t("accountDetail.updated", { when: balanceUpdated.text })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
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
      <div className="flex flex-wrap gap-2">
        <Button className="sm:w-auto" onClick={() => openCreate()}>
          <Plus />
          {t("new")}
        </Button>
        <Button className="sm:w-auto" variant="outline" onClick={() => openCreate("transfer")}>
          <ArrowLeftRight />
          {t("newTransfer")}
        </Button>
        {hasFilters ? (
          <Button
            variant="outline"
            onClick={() =>
              updateFilters({
                accounts: null,
                accountDetail: null,
                categories: null,
                end: null,
                member: null,
                q: null,
                start: null,
                type: null,
              })
            }
          >
            {t("clearFilters")}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <Search className="size-4" />
          <input
            className="min-w-0 flex-1 bg-transparent outline-none"
            value={filters.query}
            placeholder={t("search")}
            onChange={(event) => updateFilters({ q: event.target.value || null })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Filter className="size-4" />
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
        <select
          aria-label={t("filters.account")}
          className="rounded-md border bg-transparent px-2 py-1 text-sm"
          value={filters.accountIds}
          multiple
          disabled={accountDetailId !== null}
          onChange={(event) => {
            const accountIds = selectedValues(event);
            updateFilters({ accounts: accountIds.join(FILTER_SEPARATOR) || null });
          }}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t("filters.category")}
          className="rounded-md border bg-transparent px-2 py-1 text-sm"
          value={filters.categoryIds}
          multiple
          onChange={(event) => {
            const categoryIds = selectedValues(event);
            updateFilters({ categories: categoryIds.join(FILTER_SEPARATOR) || null });
          }}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t("filters.member")}
          className="rounded-md border bg-transparent px-2 py-1 text-sm"
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
        <input
          aria-label={t("filters.startDate")}
          className="rounded-md border bg-transparent px-2 py-1 text-sm"
          type="date"
          value={filters.startDate ?? ""}
          onChange={(event) => updateFilters({ start: event.target.value || null })}
        />
        <input
          aria-label={t("filters.endDate")}
          className="rounded-md border bg-transparent px-2 py-1 text-sm"
          type="date"
          value={filters.endDate ?? ""}
          onChange={(event) => updateFilters({ end: event.target.value || null })}
        />
      </div>
      <div className="grid grid-cols-4 gap-2 rounded-lg bg-muted p-3 text-center text-xs">
        <div>
          <p>{t("summary.count")}</p>
          <strong>{summary.count}</strong>
        </div>
        <div>
          <p>{t("summary.inflow")}</p>
          <strong>{formatMoney(summary.inflow, baseCurrency ?? "USD", locale)}</strong>
        </div>
        <div>
          <p>{t("summary.outflow")}</p>
          <strong>{formatMoney(summary.outflow, baseCurrency ?? "USD", locale)}</strong>
        </div>
        <div>
          <p>{t("summary.net")}</p>
          <strong>
            {formatSignedMoney(summary.inflow - summary.outflow, baseCurrency ?? "USD", locale)}
          </strong>
        </div>
      </div>
      {transactions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {hasFilters ? t("noResults") : t("empty")}
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(
            Object.groupBy(transactions, (transaction) => transaction.occurred_on),
          ).map(([date, dayTransactions]) => {
            if (!dayTransactions) return null;
            const daySubtotal = dayTransactions.reduce(
              (total, transaction) =>
                transaction.transfer_group_id ? total : total + (transaction.base_amount ?? 0),
              0,
            );
            return (
              <section key={date} className="overflow-hidden rounded-lg border">
                <header className="flex justify-between bg-muted px-3 py-2 text-xs font-medium">
                  <span>{dateLabel(date, locale)}</span>
                  <span>{formatSignedMoney(daySubtotal, baseCurrency ?? "USD", locale)}</span>
                </header>
                <ul className="divide-y">
                  {dayTransactions.map((transaction) => {
                    const account = accounts.find((item) => item.id === transaction.account_id);
                    const category = categories.find((item) => item.id === transaction.category_id);
                    const transfer = transaction.transfer_group_id !== null;
                    return (
                      <li key={transaction.id} className="flex items-center gap-3 p-3">
                        {transfer ? (
                          <ArrowLeftRight className="size-4 shrink-0 text-muted-foreground" />
                        ) : null}
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => openEdit(transaction)}
                        >
                          <p className="truncate font-medium">
                            {transfer ? t("transfer") : transaction.description}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[transaction.occurred_on, account?.name, category?.name]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </button>
                        <p
                          className={
                            transaction.amount < 0
                              ? "font-medium text-destructive"
                              : "font-medium text-primary"
                          }
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
          })}
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
