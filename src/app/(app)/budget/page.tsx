"use client";

import { useTranslations } from "next-intl";

export default function BudgetPage() {
  const tNav = useTranslations("nav");
  const t = useTranslations("common");

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{tNav("budget")}</h1>
      <p className="text-sm text-muted-foreground">{t("placeholder")}</p>
    </main>
  );
}
