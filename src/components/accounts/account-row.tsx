"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useHousehold } from "@/hooks/useHousehold";
import { displayBalance, type AccountWithBalance } from "@/lib/accounts";
import { formatMoney } from "@/lib/money";
import { useAccountsUiStore } from "@/store/accounts";
import { cn } from "@/lib/utils";
import { KindIcon } from "./kind-icon";

export function AccountRow({ account }: { account: AccountWithBalance }) {
  const t = useTranslations("accounts.row");
  const tModes = useTranslations("accounts.balanceModes");
  const locale = useLocale();
  const { memberId, numberFormat } = useHousehold();
  const { openEdit, openManualBalance } = useAccountsUiStore();

  // RLS update gating (accounts_update, #19): joint or my own accounts are
  // editable; a partner-owned shared account is visible but read-only here.
  const canManage = account.owner_member_id === null || account.owner_member_id === memberId;
  const isManual = account.balance_mode === "manual";
  const isArchived = account.is_archived;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: account.id,
    disabled: !canManage || isArchived,
  });

  const balance = displayBalance(account);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card px-3 py-3",
        isDragging && "opacity-40",
      )}
    >
      {canManage && !isArchived ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t("dragHandle")}
          className="touch-none text-muted-foreground transition-colors hover:text-foreground"
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}

      <KindIcon kind={account.kind} className="size-5 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{account.name}</p>
          {!account.is_shared ? (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("private")}
            </span>
          ) : null}
          {isArchived ? (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("archived")}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {account.currency} · {isManual ? tModes("manual") : tModes("ledger")}
        </p>
      </div>

      <p
        className={cn(
          "shrink-0 text-sm font-medium tabular-nums",
          balance < 0 && "text-destructive",
        )}
      >
        {formatMoney(balance, account.currency, locale, numberFormat)}
      </p>

      {canManage ? (
        <div className="flex shrink-0 items-center gap-1">
          {isManual && !isArchived ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t("updateBalance")}
              onClick={() => openManualBalance(account)}
            >
              <Wallet className="size-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("edit")}
            onClick={() => openEdit(account)}
          >
            <Pencil className="size-4" />
          </Button>
        </div>
      ) : null}
    </li>
  );
}
