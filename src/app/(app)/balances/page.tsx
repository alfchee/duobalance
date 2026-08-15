"use client";

import { useTranslations } from "next-intl";
import { AccountForm } from "@/components/accounts/account-form";
import { BalancesView } from "@/components/accounts/balances/balances-view";
import { ManualBalanceSheet } from "@/components/accounts/manual-balance-sheet";
import { HelpButton } from "@/components/help/help-button";

export default function BalancesPage() {
  const t = useTranslations("nav");
  return (
    <main className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("balances")}</h1>
        <HelpButton article="private-accounts-and-views" />
      </div>
      <BalancesView />
      <AccountForm />
      <ManualBalanceSheet />
    </main>
  );
}
