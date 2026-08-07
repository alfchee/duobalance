"use client";

import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { AccountForm } from "@/components/accounts/account-form";
import { AccountList } from "@/components/accounts/account-list";
import { EmptyAccounts } from "@/components/accounts/empty-state";
import { ManualBalanceSheet } from "@/components/accounts/manual-balance-sheet";
import { Button } from "@/components/ui/button";
import { useHousehold } from "@/hooks/useHousehold";
import { useAccounts } from "@/hooks/useAccounts";
import { useAccountsUiStore } from "@/store/accounts";

export default function BalancesPage() {
  const tNav = useTranslations("nav");
  const t = useTranslations("accounts");
  const { householdId } = useHousehold();
  const { data: accounts, isLoading } = useAccounts(householdId);
  const { openCreate } = useAccountsUiStore();

  const hasAccounts = (accounts?.length ?? 0) > 0;

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{tNav("balances")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button type="button" onClick={openCreate}>
          <Plus />
          {t("newAccount")}
        </Button>
      </div>

      {isLoading ? (
        <ul className="space-y-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </ul>
      ) : hasAccounts ? (
        <AccountList />
      ) : (
        <EmptyAccounts />
      )}

      <AccountForm />
      <ManualBalanceSheet />
    </main>
  );
}
