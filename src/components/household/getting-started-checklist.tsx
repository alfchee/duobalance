"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronRight, UserPlus, X } from "lucide-react";
import { useHousehold } from "@/hooks/useHousehold";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";
import { useAccountsUiStore } from "@/store/accounts";
import { useTransactionsUiStore } from "@/store/transactions";
import { useInviteMutations } from "@/hooks/useInvites";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DISMISS_PREFIX = "duobalance:dismissedChecklist:";

export function GettingStartedChecklist() {
  const t = useTranslations("onboarding.checklist");
  const router = useRouter();
  const { householdId } = useHousehold();
  const progress = useOnboardingProgress(householdId);
  const { openCreate: openAccountCreate } = useAccountsUiStore();
  const { openCreate: openTransactionCreate } = useTransactionsUiStore();
  const { create: createInvite } = useInviteMutations(householdId);

  const [dismissed, setDismissed] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    if (!householdId) return;
    const stored = localStorage.getItem(`${DISMISS_PREFIX}${householdId}`);
    setDismissed(stored === "true");
  }, [householdId]);

  if (!householdId || progress.isLoading || progress.isComplete || dismissed) {
    return null;
  }

  function handleDismiss() {
    if (!householdId) return;
    localStorage.setItem(`${DISMISS_PREFIX}${householdId}`, "true");
    setDismissed(true);
  }

  const completedCount =
    (progress.hasAccounts ? 1 : 0) +
    (progress.hasTransactions ? 1 : 0) +
    (progress.hasBudgets ? 1 : 0) +
    (progress.hasPartner ? 1 : 0);

  const percentage = Math.round((completedCount / 4) * 100);

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    const email = inviteEmail.trim();
    if (!email) return;

    try {
      await createInvite.mutateAsync(email);
      setInviteEmail("");
      setInviteOpen(false);
    } catch {
      setInviteError(t("inviteError"));
    }
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-ring">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
              {t("badge")}
            </span>
            <h3 className="mt-2 text-lg font-black tracking-tight">{t("title")}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("progressCount", { completed: completedCount, total: 4 })}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            className="-mr-2 -mt-2 size-8 text-muted-foreground hover:text-foreground"
            aria-label={t("dismiss")}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>

        <div className="mt-4 grid gap-2">
          {/* Step 1: Add account */}
          <div
            className={`flex items-center justify-between rounded-xl border p-3 text-sm transition-colors ${
              progress.hasAccounts
                ? "bg-secondary/40 border-transparent"
                : "bg-background border-border"
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`grid size-6 place-items-center rounded-full text-xs font-bold ${
                  progress.hasAccounts
                    ? "bg-success text-success-foreground"
                    : "border-2 border-muted-foreground/40 text-muted-foreground"
                }`}
              >
                {progress.hasAccounts ? <Check className="size-3.5" /> : "1"}
              </span>
              <span
                className={
                  progress.hasAccounts ? "line-through text-muted-foreground" : "font-medium"
                }
              >
                {t("stepAccount")}
              </span>
            </div>
            {!progress.hasAccounts ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={openAccountCreate}
                className="h-8 gap-1 text-xs font-bold"
              >
                {t("actionAdd")} <ChevronRight className="size-3" />
              </Button>
            ) : null}
          </div>

          {/* Step 2: Record transaction */}
          <div
            className={`flex items-center justify-between rounded-xl border p-3 text-sm transition-colors ${
              progress.hasTransactions
                ? "bg-secondary/40 border-transparent"
                : "bg-background border-border"
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`grid size-6 place-items-center rounded-full text-xs font-bold ${
                  progress.hasTransactions
                    ? "bg-success text-success-foreground"
                    : "border-2 border-muted-foreground/40 text-muted-foreground"
                }`}
              >
                {progress.hasTransactions ? <Check className="size-3.5" /> : "2"}
              </span>
              <span
                className={
                  progress.hasTransactions ? "line-through text-muted-foreground" : "font-medium"
                }
              >
                {t("stepTransaction")}
              </span>
            </div>
            {!progress.hasTransactions ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openTransactionCreate("transaction")}
                className="h-8 gap-1 text-xs font-bold"
              >
                {t("actionRecord")} <ChevronRight className="size-3" />
              </Button>
            ) : null}
          </div>

          {/* Step 3: Set a budget */}
          <div
            className={`flex items-center justify-between rounded-xl border p-3 text-sm transition-colors ${
              progress.hasBudgets
                ? "bg-secondary/40 border-transparent"
                : "bg-background border-border"
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`grid size-6 place-items-center rounded-full text-xs font-bold ${
                  progress.hasBudgets
                    ? "bg-success text-success-foreground"
                    : "border-2 border-muted-foreground/40 text-muted-foreground"
                }`}
              >
                {progress.hasBudgets ? <Check className="size-3.5" /> : "3"}
              </span>
              <span
                className={
                  progress.hasBudgets ? "line-through text-muted-foreground" : "font-medium"
                }
              >
                {t("stepBudget")}
              </span>
            </div>
            {!progress.hasBudgets ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => router.push("/budget")}
                className="h-8 gap-1 text-xs font-bold"
              >
                {t("actionSet")} <ChevronRight className="size-3" />
              </Button>
            ) : null}
          </div>

          {/* Step 4: Invite partner */}
          <div
            className={`flex items-center justify-between rounded-xl border p-3 text-sm transition-colors ${
              progress.hasPartner
                ? "bg-secondary/40 border-transparent"
                : "bg-background border-border"
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`grid size-6 place-items-center rounded-full text-xs font-bold ${
                  progress.hasPartner
                    ? "bg-success text-success-foreground"
                    : "border-2 border-muted-foreground/40 text-muted-foreground"
                }`}
              >
                {progress.hasPartner ? <Check className="size-3.5" /> : "4"}
              </span>
              <span
                className={
                  progress.hasPartner ? "line-through text-muted-foreground" : "font-medium"
                }
              >
                {t("stepPartner")}
              </span>
            </div>
            {!progress.hasPartner ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setInviteOpen(true)}
                className="h-8 gap-1 text-xs font-bold"
              >
                {t("actionInvite")} <UserPlus className="size-3" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("inviteModalTitle")}</DialogTitle>
            <DialogDescription>{t("inviteModalDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSendInvite} className="mt-3 flex flex-col gap-4">
            <Input
              type="email"
              required
              placeholder="partner@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            {inviteError ? (
              <p role="alert" className="text-xs text-destructive">
                {inviteError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                {t("inviteCancel")}
              </Button>
              <Button type="submit" disabled={createInvite.isPending}>
                {createInvite.isPending ? t("inviteSending") : t("inviteSend")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
