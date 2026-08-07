"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useHousehold } from "@/hooks/useHousehold";
import { useAccountMutations } from "@/hooks/useAccounts";
import { useCurrencies } from "@/hooks/useCurrencies";
import { accountBalance, type Account } from "@/lib/accounts";
import { formatMoney, maskMoneyInput, parseMoneyInput, roundToMinorUnit } from "@/lib/money";
import { useAccountsUiStore } from "@/store/accounts";

export function ManualBalanceSheet() {
  const { manualBalanceAccount, closeManualBalance } = useAccountsUiStore();
  return (
    <Sheet
      open={manualBalanceAccount != null}
      onOpenChange={(open) => !open && closeManualBalance()}
    >
      <ManualBalanceContent
        key={manualBalanceAccount?.id ?? "none"}
        account={manualBalanceAccount}
        onClose={closeManualBalance}
      />
    </Sheet>
  );
}

function ManualBalanceContent({
  account,
  onClose,
}: {
  account: Account | null;
  onClose: () => void;
}) {
  const t = useTranslations("accounts.manualBalanceSheet");
  const locale = useLocale();
  const { householdId } = useHousehold();
  const { updateManualBalance } = useAccountMutations(householdId);
  const { data: currencies } = useCurrencies();

  const minorUnit = currencies?.find((c) => c.code === account?.currency)?.minor_unit ?? 2;
  const current = account ? accountBalance(account) : 0;

  const [value, setValue] = useState(() =>
    account ? new Intl.NumberFormat(locale).format(current) : "",
  );
  const [error, setError] = useState(false);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setError(false);
    setValue(maskMoneyInput(e.target.value, locale, minorUnit));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!account) return;
    const parsed = parseMoneyInput(value, locale);
    if (parsed == null) {
      setError(true);
      return;
    }
    try {
      await updateManualBalance.mutateAsync({
        id: account.id,
        manualBalance: roundToMinorUnit(parsed, minorUnit),
      });
      onClose();
    } catch {
      setError(true);
    }
  }

  return (
    <SheetContent side="bottom" className="sm:mx-auto sm:max-w-md">
      <SheetHeader>
        <SheetTitle>{t("title")}</SheetTitle>
        <SheetDescription>{t("subtitle")}</SheetDescription>
      </SheetHeader>

      <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-4">
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <span className="text-sm text-muted-foreground">{t("current")}</span>
          <span className="text-sm font-medium tabular-nums">
            {formatMoney(current, account?.currency ?? "USD", locale)}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="manual-balance-input">{t("newValue")}</Label>
          <Input
            id="manual-balance-input"
            inputMode="decimal"
            value={value}
            onChange={handleChange}
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t("error")}
          </p>
        ) : null}

        <SheetFooter>
          <Button type="submit" disabled={updateManualBalance.isPending}>
            {updateManualBalance.isPending ? t("saving") : t("save")}
          </Button>
        </SheetFooter>
      </form>
    </SheetContent>
  );
}
