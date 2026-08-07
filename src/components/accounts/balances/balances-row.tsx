"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Wallet } from "lucide-react";
import { displayBalance, type Account } from "@/lib/accounts";
import { formatUpdatedAgo, isStaleBalance } from "@/lib/balances";
import { formatMoney } from "@/lib/money";
import { useAccountsUiStore } from "@/store/accounts";
import { cn } from "@/lib/utils";
import { KindIcon } from "../kind-icon";
import { OwnerBadge } from "./owner-badge";

// A read-only row in the Balances view (issue #21). Tapping opens the account
// form for edit; manual-mode accounts get a one-tap "Update balance" affordance
// (the wallet button), matching #20's manual-balance sheet.
//
// The freshness line — "Updated Nd ago" — is non-negotiable for this view:
// accounts are only as fresh as the last manual update, and an account that
// hasn't been touched in 14+ days gets a visible "stale" warning. Ledger
// accounts don't get a stale flag — once #26 lands, transactions implicitly
// keep them fresh.
export function BalancesRow({ account, now }: { account: Account; now: Date }) {
  const t = useTranslations("balances");
  const tModes = useTranslations("accounts.balanceModes");
  const locale = useLocale();
  const { openEdit, openManualBalance } = useAccountsUiStore();

  const isManual = account.balance_mode === "manual";
  const balance = displayBalance(account);
  const freshness = formatUpdatedAgo(account.balance_updated_at, now, locale);
  const stale = isStaleBalance(account, now);

  return (
    <li className="border-b last:border-b-0">
      <div className="flex items-center gap-3 p-3">
        <KindIcon kind={account.kind} className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openEdit(account)}
              className="min-w-0 truncate text-left text-sm font-medium hover:underline"
            >
              {account.name}
            </button>
            <OwnerBadge account={account} />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {account.institution ?? account.currency}
            {" · "}
            {isManual ? tModes("manual") : tModes("ledger")}
          </p>
        </div>
        <p
          className={cn(
            "shrink-0 text-right text-sm font-medium tabular-nums",
            balance < 0 && "text-destructive",
          )}
        >
          {formatMoney(balance, account.currency, locale)}
        </p>
        {isManual ? (
          <button
            type="button"
            onClick={() => openManualBalance(account)}
            aria-label={t("updateBalance")}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Wallet className="size-4" />
          </button>
        ) : null}
      </div>
      <p
        className={cn(
          "flex items-center gap-1 px-3 pb-2 text-[11px]",
          stale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        )}
      >
        {stale ? <AlertTriangle className="size-3" /> : null}
        {t("updated", { when: freshness.text })}
        {stale ? ` · ${t("stale")}` : ""}
      </p>
    </li>
  );
}
