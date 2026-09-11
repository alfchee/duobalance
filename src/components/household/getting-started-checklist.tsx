"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ChevronRight, Download, UserPlus, X } from "lucide-react";
import { useHousehold } from "@/hooks/useHousehold";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";
import { useAccountsUiStore } from "@/store/accounts";
import { useInviteMutations } from "@/hooks/useInvites";
import { usePwaInstall } from "@/components/pwa/pwa-manager";
import { isIOS } from "@/lib/pwa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FirstRunPrompt } from "./first-run-prompt";

export const DISMISS_PREFIX = "duobalance:dismissedChecklist:";
export const FIRST_RUN_DISMISS_PREFIX = "duobalance:dismissedFirstRun:";

export function GettingStartedChecklist() {
  const t = useTranslations("onboarding.checklist");
  const tFirstRun = useTranslations("onboarding.firstRun");
  const { householdId } = useHousehold();
  const progress = useOnboardingProgress(householdId);
  const { openCreate: openAccountCreate } = useAccountsUiStore();
  const { create: createInvite } = useInviteMutations(householdId);
  const { install, installAvailable, installed } = usePwaInstall();

  const [dismissedChecklist, setDismissedChecklist] = useState(true);
  const [dismissedFirstRun, setDismissedFirstRun] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  // isIOS() reads navigator — resolve after mount to avoid SSR hydration mismatch.
  const [isIOSDevice, setIsIOSDevice] = useState(false);

  useEffect(() => {
    setIsIOSDevice(isIOS());
  }, []);

  useEffect(() => {
    if (!householdId) return;
    setDismissedChecklist(localStorage.getItem(`${DISMISS_PREFIX}${householdId}`) === "true");
    setDismissedFirstRun(
      localStorage.getItem(`${FIRST_RUN_DISMISS_PREFIX}${householdId}`) === "true",
    );
  }, [householdId]);

  function handleDismissChecklist() {
    if (!householdId) return;
    localStorage.setItem(`${DISMISS_PREFIX}${householdId}`, "true");
    setDismissedChecklist(true);
  }

  function handleDismissFirstRun() {
    if (!householdId) return;
    localStorage.setItem(`${FIRST_RUN_DISMISS_PREFIX}${householdId}`, "true");
    setDismissedFirstRun(true);
  }

  if (!householdId || progress.isLoading) {
    return null;
  }

  // #192: brand-new users see only the first-run prompt — single CTA to record one expense.
  // No account/budget/partner step blocks the transaction form.
  // Dismissing the first-run prompt (`dismissedFirstRun`) does NOT suppress the
  // post-transaction checklist; dismissing the checklist (`dismissedChecklist`)
  // suppresses both stages to preserve existing users' choice.
  if (!progress.hasTransactions) {
    if (dismissedFirstRun || dismissedChecklist) return null;
    return <FirstRunPrompt onDismiss={handleDismissFirstRun} dismissLabel={tFirstRun("dismiss")} />;
  }

  if (dismissedChecklist || progress.isComplete) {
    return null;
  }

  // After the first transaction, remaining setup is offered as dismissible
  // prompts — account, install, partner — never as a blocker.
  // Budget setup is intentionally not part of this checklist (#198): it is
  // surfaced later as a data-driven suggestion derived from recorded spend.
  // The install step is device-local (PWA) and non-blocking: `isComplete`
  // stays core-only so browsers without an install prompt can still finish
  // onboarding. When the step can act (native prompt, iOS guide) — or the
  // app is already installed — it counts toward the displayed progress.
  const showInstallStep = installed || installAvailable || isIOSDevice;
  const totalSteps = showInstallStep ? 4 : 3;
  const partnerStepNumber = showInstallStep ? "4" : "3";
  const completedCount =
    (progress.hasAccounts ? 1 : 0) +
    (progress.hasTransactions ? 1 : 0) +
    (progress.hasPartner ? 1 : 0) +
    (showInstallStep && installed ? 1 : 0);

  const percentage = Math.round((completedCount / totalSteps) * 100);

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
              {t("progressCount", { completed: completedCount, total: totalSteps })}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleDismissChecklist}
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

          {/* Step 2: Install app — one-tap PWA install, no store needed */}
          {showInstallStep ? (
            <div
              className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-sm transition-colors ${
                installed ? "bg-secondary/40 border-transparent" : "bg-background border-border"
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                    installed
                      ? "bg-success text-success-foreground"
                      : "border-2 border-muted-foreground/40 text-muted-foreground"
                  }`}
                >
                  {installed ? <Check className="size-3.5" /> : "2"}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block ${
                      installed ? "line-through text-muted-foreground" : "font-medium"
                    }`}
                  >
                    {t("stepInstall")}
                  </span>
                  {!installed ? (
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {t("stepInstallDescription")}
                    </span>
                  ) : null}
                </span>
              </div>
              {!installed ? (
                isIOSDevice ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    asChild
                    className="h-8 shrink-0 gap-1 text-xs font-bold"
                  >
                    <Link href="/install">
                      {t("actionInstall")} <ChevronRight className="size-3" />
                    </Link>
                  </Button>
                ) : installAvailable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void install()}
                    className="h-8 shrink-0 gap-1 text-xs font-bold"
                  >
                    {t("actionInstall")} <Download className="size-3" />
                  </Button>
                ) : null
              ) : null}
            </div>
          ) : null}

          {/* Step 3: Record transaction — always complete once we reach this checklist */}
          <div className="flex items-center justify-between rounded-xl border p-3 text-sm transition-colors bg-secondary/40 border-transparent">
            <div className="flex items-center gap-3">
              <span className="grid size-6 place-items-center rounded-full bg-success text-xs font-bold text-success-foreground">
                <Check className="size-3.5" />
              </span>
              <span className="line-through text-muted-foreground">{t("stepTransaction")}</span>
            </div>
          </div>

          {/* Step 4: Invite partner (step 3 when install is unavailable) */}
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
                {progress.hasPartner ? <Check className="size-3.5" /> : partnerStepNumber}
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
