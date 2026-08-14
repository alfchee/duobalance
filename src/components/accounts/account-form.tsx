"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useHousehold } from "@/hooks/useHousehold";
import { useAccountMutations, type AccountInput } from "@/hooks/useAccounts";
import { useCurrencies } from "@/hooks/useCurrencies";
import {
  ACCOUNT_KINDS,
  isPrivateNeedsOwnerError,
  type Account,
  type AccountKind,
} from "@/lib/accounts";
import { maskMoneyInput, parseMoneyInput, roundToMinorUnit } from "@/lib/money";
import { useAccountsUiStore } from "@/store/accounts";
import { CurrencyPicker } from "./currency-picker";

type Draft = {
  name: string;
  kind: AccountKind;
  currency: string | null;
  balanceMode: "ledger" | "manual";
  openingBalance: string;
  manualBalance: string;
  creditLimit: string;
  isShared: boolean;
  ownerIsMine: boolean;
};

type FormError =
  | "nameRequired"
  | "kindRequired"
  | "currencyRequired"
  | "balanceRequired"
  | "privateNeedsOwner"
  | "generic";

function formatInputAmount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function AccountForm() {
  const { formOpen, editingAccount, closeForm } = useAccountsUiStore();
  return (
    <Dialog open={formOpen} onOpenChange={(open) => !open && closeForm()}>
      <AccountFormContent
        key={editingAccount?.id ?? "create"}
        account={editingAccount}
        onClose={closeForm}
      />
    </Dialog>
  );
}

function AccountFormContent({
  account,
  onClose,
}: {
  account: Account | null;
  onClose: () => void;
}) {
  const t = useTranslations("accounts.form");
  const tKinds = useTranslations("accounts.kinds");
  const tModes = useTranslations("accounts.balanceModes");
  const locale = useLocale();
  const { memberId, baseCurrency, householdId, numberFormat } = useHousehold();
  const { create, update, archive } = useAccountMutations(householdId);
  const { data: currencies } = useCurrencies();

  const [draft, setDraft] = useState<Draft>(() => ({
    name: account?.name ?? "",
    kind: (account?.kind as AccountKind) ?? "checking",
    currency: account?.currency ?? baseCurrency,
    balanceMode: account?.balance_mode === "manual" ? "manual" : "ledger",
    openingBalance: account ? formatInputAmount(account.opening_balance, locale) : "0",
    manualBalance:
      account?.manual_balance != null ? formatInputAmount(account.manual_balance, locale) : "",
    creditLimit:
      account?.credit_limit != null ? formatInputAmount(account.credit_limit, locale) : "",
    isShared: account?.is_shared ?? true,
    ownerIsMine: account ? account.owner_member_id != null : false,
  }));
  const [formError, setFormError] = useState<FormError | null>(null);

  const minorUnit = currencies?.find((c) => c.code === draft.currency)?.minor_unit ?? 2;
  const pending = create.isPending || update.isPending || archive.isPending;

  function setAmount(field: "openingBalance" | "manualBalance" | "creditLimit") {
    return (e: ChangeEvent<HTMLInputElement>) =>
      setDraft((d) => ({
        ...d,
        [field]: maskMoneyInput(e.target.value, locale, minorUnit, numberFormat),
      }));
  }

  function handleShareChange(shared: boolean) {
    setDraft((d) => ({
      ...d,
      isShared: shared,
      // A private account must belong to one of you (accounts_private_needs_owner).
      ownerIsMine: shared ? d.ownerIsMine : true,
    }));
  }

  function handleBalanceModeChange(mode: "ledger" | "manual") {
    setDraft((d) => {
      if (mode === d.balanceMode) return d;
      if (mode === "manual" && d.manualBalance === "" && d.openingBalance) {
        return { ...d, balanceMode: mode, manualBalance: d.openingBalance };
      }
      if (mode === "ledger" && d.openingBalance === "" && d.manualBalance) {
        return { ...d, balanceMode: mode, openingBalance: d.manualBalance };
      }
      return { ...d, balanceMode: mode };
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const name = draft.name.trim();
    if (!name || name.length > 80) return setFormError("nameRequired");
    if (!draft.kind) return setFormError("kindRequired");
    if (!draft.currency) return setFormError("currencyRequired");

    const amountSource =
      draft.balanceMode === "manual" ? draft.manualBalance : draft.openingBalance;
    const parsedAmount = parseMoneyInput(amountSource, locale, numberFormat);
    if (parsedAmount == null) return setFormError("balanceRequired");

    const creditRaw = draft.creditLimit.trim();
    const parsedCredit = creditRaw ? parseMoneyInput(creditRaw, locale, numberFormat) : null;
    if (creditRaw && parsedCredit == null) return setFormError("generic");
    if (!draft.isShared && !memberId) return setFormError("generic");

    const input: AccountInput = {
      name,
      kind: draft.kind,
      currency: draft.currency,
      balance_mode: draft.balanceMode,
      opening_balance:
        draft.balanceMode === "ledger"
          ? roundToMinorUnit(parsedAmount, minorUnit)
          : (account?.opening_balance ?? 0),
      manual_balance:
        draft.balanceMode === "manual" ? roundToMinorUnit(parsedAmount, minorUnit) : null,
      credit_limit: parsedCredit != null ? roundToMinorUnit(parsedCredit, minorUnit) : null,
      is_shared: draft.isShared,
      owner_member_id: draft.isShared ? (draft.ownerIsMine ? memberId : null) : memberId,
    };

    try {
      if (account) {
        // Claiming a joint account while un-sharing in one statement trips the
        // accounts_check_claim_stays_shared trigger — claim first, then unshare.
        if (account.owner_member_id == null && !input.is_shared && memberId) {
          await update.mutateAsync({ id: account.id, ...input, is_shared: true });
        }
        await update.mutateAsync({ id: account.id, ...input });
      } else {
        await create.mutateAsync(input);
      }
      onClose();
    } catch (err) {
      setFormError(isPrivateNeedsOwnerError(err) ? "privateNeedsOwner" : "generic");
    }
  }

  async function handleArchive() {
    if (!account) return;
    setFormError(null);
    try {
      await archive.mutateAsync({ id: account.id, isArchived: !account.is_archived });
      onClose();
    } catch {
      setFormError("generic");
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{account ? t("titleEdit") : t("titleCreate")}</DialogTitle>
        <DialogDescription className="sr-only">
          {account ? t("titleEdit") : t("titleCreate")}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-name">{t("name")}</Label>
          <Input
            id="account-name"
            value={draft.name}
            maxLength={80}
            placeholder={t("namePlaceholder")}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="account-kind">{t("kind")}</Label>
          <Select
            value={draft.kind}
            onValueChange={(kind) => setDraft((d) => ({ ...d, kind: kind as AccountKind }))}
          >
            <SelectTrigger id="account-kind" className="w-full">
              <SelectValue placeholder={t("kindPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {tKinds(kind)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("currency")}</Label>
          <CurrencyPicker
            value={draft.currency}
            onSelect={(code) => setDraft((d) => ({ ...d, currency: code }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>{tModes("label")}</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={draft.balanceMode === "ledger" ? "default" : "outline"}
              onClick={() => handleBalanceModeChange("ledger")}
            >
              {tModes("ledger")}
            </Button>
            <Button
              type="button"
              variant={draft.balanceMode === "manual" ? "default" : "outline"}
              onClick={() => handleBalanceModeChange("manual")}
            >
              {tModes("manual")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {draft.balanceMode === "ledger"
              ? tModes("ledgerDescription")
              : tModes("manualDescription")}
          </p>
        </div>

        {draft.balanceMode === "ledger" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-opening">{t("openingBalance")}</Label>
            <Input
              id="account-opening"
              inputMode="decimal"
              value={draft.openingBalance}
              onChange={setAmount("openingBalance")}
            />
            <p className="text-xs text-muted-foreground">{t("openingBalanceHint")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-manual">{t("manualBalance")}</Label>
            <Input
              id="account-manual"
              inputMode="decimal"
              value={draft.manualBalance}
              onChange={setAmount("manualBalance")}
            />
          </div>
        )}

        {draft.kind === "credit_card" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-credit">{t("creditLimit")}</Label>
            <Input
              id="account-credit"
              inputMode="decimal"
              value={draft.creditLimit}
              onChange={setAmount("creditLimit")}
            />
            <p className="text-xs text-muted-foreground">{t("creditLimitHint")}</p>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">{t("share")}</p>
            <p className="text-xs text-muted-foreground">{t("shareHint")}</p>
          </div>
          <Switch checked={draft.isShared} onCheckedChange={handleShareChange} />
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("ownership")}</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={!draft.ownerIsMine ? "default" : "outline"}
              disabled={!draft.isShared}
              onClick={() => setDraft((d) => ({ ...d, ownerIsMine: false }))}
            >
              {t("joint")}
            </Button>
            <Button
              type="button"
              variant={draft.ownerIsMine ? "default" : "outline"}
              onClick={() => setDraft((d) => ({ ...d, ownerIsMine: true }))}
            >
              {t("mine")}
            </Button>
          </div>
          {!draft.isShared ? (
            <p className="text-xs text-muted-foreground">{t("privateNote")}</p>
          ) : null}
        </div>

        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${formError}`)}
          </p>
        ) : null}

        <DialogFooter className="gap-2">
          {account ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={handleArchive}
              disabled={pending}
            >
              {account.is_archived ? t("restore") : t("archive")}
            </Button>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
