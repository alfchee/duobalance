"use client";

import { useTranslations } from "next-intl";
import { BudgetView } from "@/components/budgets/budget-view";

export default function BudgetPage() {
  const tNav = useTranslations("nav");
  return (
    <main className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <h1 className="sr-only">{tNav("budget")}</h1>
      <BudgetView />
    </main>
  );
}
