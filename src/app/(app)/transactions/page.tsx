"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { AccountForm } from "@/components/accounts/account-form";
import { ManualBalanceSheet } from "@/components/accounts/manual-balance-sheet";
import { TransactionsView } from "@/components/transactions/transactions-view";

export default function TransactionsPage() {
  const tNav = useTranslations("nav");
  const tTransactions = useTranslations("transactions");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 md:pb-8">
      <h1 className="sr-only">{tNav("transactions")}</h1>
      <div>
        <Suspense
          fallback={<p className="text-sm text-muted-foreground">{tTransactions("loading")}</p>}
        >
          <TransactionsView />
        </Suspense>
      </div>
      <AccountForm />
      <ManualBalanceSheet />
    </main>
  );
}
