"use client";

import { useTranslations } from "next-intl";
import { TransactionsView } from "@/components/transactions/transactions-view";

export default function TransactionsPage() {
  const tNav = useTranslations("nav");

  return (
    <main className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">{tNav("transactions")}</h1>
      <div className="mt-4">
        <TransactionsView />
      </div>
    </main>
  );
}
