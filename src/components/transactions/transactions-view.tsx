"use client";

import { Pencil, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { useHousehold } from "@/hooks/useHousehold";
import { useTransactions } from "@/hooks/useTransactions";
import { formatSignedMoney } from "@/lib/money";
import { useTransactionsUiStore } from "@/store/transactions";

export function TransactionsView() {
  const locale = useLocale();
  const t = useTranslations("transactions");
  const { householdId } = useHousehold();
  const { data: transactions = [], isLoading, isError, refetch } = useTransactions(householdId);
  const { data: accounts = [] } = useAccounts(householdId);
  const { data: categories = [] } = useCategories(householdId);
  const openCreate = useTransactionsUiStore((state) => state.openCreate);
  const openEdit = useTransactionsUiStore((state) => state.openEdit);

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (isError)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{t("loadError")}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {t("retry")}
        </Button>
      </div>
    );

  return (
    <div className="space-y-4">
      <Button className="w-full sm:w-auto" onClick={openCreate}>
        <Plus />
        {t("new")}
      </Button>
      {transactions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {transactions.map((transaction) => {
            const account = accounts.find((item) => item.id === transaction.account_id);
            const category = categories.find((item) => item.id === transaction.category_id);
            return (
              <li key={transaction.id} className="flex items-center gap-3 p-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => openEdit(transaction)}
                >
                  <p className="truncate font-medium">{transaction.description}</p>
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
      )}
    </div>
  );
}
