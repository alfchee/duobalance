"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useHousehold } from "@/hooks/useHousehold";
import { useAccountMutations } from "@/hooks/useAccounts";
import { KindIcon } from "./kind-icon";

const DEFAULTS = [
  { kind: "cash", nameKey: "defaultCash" },
  { kind: "checking", nameKey: "defaultChecking" },
  { kind: "credit_card", nameKey: "defaultCreditCard" },
] as const;

export function EmptyAccounts() {
  const t = useTranslations("accounts.empty");
  const { householdId, baseCurrency } = useHousehold();
  const { create } = useAccountMutations(householdId);

  function quickCreate(kind: string, name: string) {
    if (!householdId || !baseCurrency) return;
    create.mutate({
      name,
      kind,
      currency: baseCurrency,
      balance_mode: "ledger",
      opening_balance: 0,
      manual_balance: null,
      credit_limit: null,
      is_shared: true,
      owner_member_id: null,
    });
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border bg-card p-8 text-center">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {DEFAULTS.map((d) => (
          <Button
            key={d.kind}
            type="button"
            variant="outline"
            disabled={create.isPending}
            onClick={() => quickCreate(d.kind, t(d.nameKey))}
          >
            <KindIcon kind={d.kind} className="size-4" />
            {t(d.nameKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}
