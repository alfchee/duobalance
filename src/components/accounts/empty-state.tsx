"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { HelpCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHousehold } from "@/hooks/useHousehold";
import { useAccountMutations, type AccountInput } from "@/hooks/useAccounts";
import { useCurrencies } from "@/hooks/useCurrencies";
import { maskMoneyInput, parseMoneyInput, roundToMinorUnit } from "@/lib/money";
import { isDebtKind } from "@/lib/accounts";
import { useAccountsUiStore } from "@/store/accounts";
import type { AccountKind } from "@/lib/accounts";
import { KindIcon } from "./kind-icon";

type StarterItem = {
  kind: AccountKind;
  nameKey: "defaultCash" | "defaultChecking" | "defaultCreditCard";
  enabled: boolean;
  name: string;
  balance: string;
};

export function EmptyAccounts() {
  const t = useTranslations("accounts.empty");
  const locale = useLocale();
  const { householdId, baseCurrency, numberFormat } = useHousehold();
  const { createBatch } = useAccountMutations(householdId);
  const { openCreate } = useAccountsUiStore();
  const { data: currencies } = useCurrencies();
  const minorUnit = currencies?.find((currency) => currency.code === baseCurrency)?.minor_unit ?? 2;

  const [starters, setStarters] = useState<StarterItem[]>([
    { kind: "cash", nameKey: "defaultCash", enabled: true, name: "", balance: "" },
    { kind: "checking", nameKey: "defaultChecking", enabled: true, name: "", balance: "" },
    { kind: "credit_card", nameKey: "defaultCreditCard", enabled: true, name: "", balance: "" },
  ]);
  const [balanceError, setBalanceError] = useState(false);

  function updateStarter(index: number, patch: Partial<StarterItem>) {
    setStarters((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function handleBatchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBalanceError(false);
    if (!householdId || !baseCurrency) return;

    const selected = starters.filter((s) => s.enabled);
    if (selected.length === 0) return;

    const payload: AccountInput[] = [];
    for (const starter of selected) {
      const rawBalance = starter.balance.trim();
      const parsedBalance = rawBalance ? parseMoneyInput(rawBalance, locale, numberFormat) : 0;
      if (parsedBalance == null) {
        setBalanceError(true);
        return;
      }

      const name = starter.name.trim() || t(starter.nameKey);
      payload.push({
        name,
        kind: starter.kind,
        currency: baseCurrency,
        balance_mode: "ledger",
        opening_balance: isDebtKind(starter.kind)
          ? -Math.abs(roundToMinorUnit(parsedBalance, minorUnit))
          : roundToMinorUnit(parsedBalance, minorUnit),
        manual_balance: null,
        credit_limit: null,
        is_shared: true,
        owner_member_id: null,
      });
    }

    createBatch.mutate(payload);
  }

  return (
    <div className="flex flex-col gap-6 rounded-2xl border bg-card p-5 sm:p-8 shadow-ring">
      <div className="text-center sm:text-left">
        <h2 className="text-xl font-black tracking-tight">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <form onSubmit={handleBatchSubmit} className="space-y-4">
        <div className="grid gap-3">
          {starters.map((item, index) => {
            const defaultName = t(item.nameKey);
            return (
              <div
                key={item.kind}
                className="flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center sm:gap-4 bg-background"
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(e) => updateStarter(index, { enabled: e.target.checked })}
                    aria-label={t("selectStarter", { name: defaultName })}
                    className="size-4 rounded border-input"
                  />
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary">
                    <KindIcon kind={item.kind} className="size-4" />
                  </div>
                </div>

                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  <Input
                    type="text"
                    value={item.name}
                    onChange={(e) => updateStarter(index, { name: e.target.value })}
                    placeholder={defaultName}
                    disabled={!item.enabled}
                    className="h-10 text-sm"
                  />
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={item.balance}
                    onChange={(e) =>
                      updateStarter(index, {
                        balance: maskMoneyInput(e.target.value, locale, minorUnit, numberFormat),
                      })
                    }
                    placeholder={t("initialBalancePlaceholder")}
                    disabled={!item.enabled}
                    className="h-10 text-sm"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-muted bg-secondary/50 p-3.5 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <HelpCircle className="mt-0.5 size-4 shrink-0 text-foreground" />
            <div className="space-y-1">
              <p className="font-semibold text-foreground">{t("modeExplanationTitle")}</p>
              <p>{t("modeExplanationBody")}</p>
              <Link
                href="/help/ledger-vs-manual-balance"
                className="inline-flex items-center font-medium text-primary hover:underline"
              >
                {t("learnMoreHelp")}
              </Link>
            </div>
          </div>
        </div>

        {balanceError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("invalidBalance")}
          </p>
        ) : null}
        {createBatch.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("error")}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="submit"
            size="lg"
            disabled={createBatch.isPending || starters.every((s) => !s.enabled)}
          >
            {createBatch.isPending ? t("creatingBatch") : t("createSelected")}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openCreate}
            className="text-muted-foreground"
          >
            <Plus className="mr-1 size-4" />
            {t("addSingleCustom")}
          </Button>
        </div>
      </form>
    </div>
  );
}
