"use client";

import { useTranslations } from "next-intl";
import { AccountForm } from "@/components/accounts/account-form";
import { BalancesView } from "@/components/accounts/balances/balances-view";
import { ManualBalanceSheet } from "@/components/accounts/manual-balance-sheet";

// Issue #21 Balances screen — the Honeydue-style read-mostly home view that
// replaces the prior list-only layout. Drag-to-reorder and archived toggles
// remain accessible via the account form (each row opens it for edit).
export default function BalancesPage() {
  const t = useTranslations("nav");
  return (
    <main className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">{t("balances")}</h1>
      </div>
      <BalancesView />
      <AccountForm />
      <ManualBalanceSheet />
    </main>
  );
}
