"use client";

import { useState } from "react";
import { ShieldAlert, UserMinus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/useAccounts";
import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdCommands } from "@/hooks/useHouseholdCommands";
import { useHouseholdMembers, type HouseholdMember } from "@/hooks/useHouseholdMembers";
import { useInviteMutations, usePendingInvites } from "@/hooks/useInvites";

function dateFormatter(locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
}

export function MembersSection({ embedded = false }: { embedded?: boolean }) {
  const { householdId, role, memberId } = useHousehold();
  const t = useTranslations("settings.members");
  const tErrors = useTranslations("settings.members.errors");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const isOwner = role === "owner";

  const members = useHouseholdMembers(householdId);
  const accounts = useAccounts(householdId);
  const invites = usePendingInvites(householdId);
  const { create, revoke, resend } = useInviteMutations(householdId);
  const { transferOwnership, removeMember } = useHouseholdCommands();

  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Transfer Ownership state
  const [transferTarget, setTransferTarget] = useState<HouseholdMember | null>(null);
  const [demoteSelf, setDemoteSelf] = useState(false);
  const [transferPending, setTransferPending] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  // Remove Member state
  const [removeTarget, setRemoveTarget] = useState<HouseholdMember | null>(null);
  const [dispositions, setDispositions] = useState<Record<string, "transfer" | "joint">>({});
  const [removePending, setRemovePending] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const fmt = dateFormatter(locale);

  function inviteErrorKey(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.status === 429) return "rateLimited";
      if (err.status === 502) return "emailFailed";
      if (err.status === 403) return "notOwner";
    }
    return "generic";
  }

  async function handleInviteSubmit(formData: FormData) {
    const target = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!target) return;
    setFormError(null);
    try {
      await create.mutateAsync(target);
      setEmail("");
    } catch (err) {
      setFormError(inviteErrorKey(err));
    }
  }

  async function handleRevoke(inviteId: string) {
    setActionError(null);
    try {
      await revoke.mutateAsync(inviteId);
    } catch (err) {
      setActionError(inviteErrorKey(err));
    }
  }

  async function handleResend(inviteId: string) {
    setActionError(null);
    try {
      await resend.mutateAsync(inviteId);
    } catch (err) {
      setActionError(inviteErrorKey(err));
    }
  }

  function handleOpenTransfer(member: HouseholdMember) {
    setTransferError(null);
    setDemoteSelf(false);
    setTransferTarget(member);
  }

  function handleOpenRemove(member: HouseholdMember) {
    setRemoveError(null);
    // Find all shared accounts owned by member and default disposition to "transfer"
    const targetOwned =
      accounts.data?.filter((a) => a.is_shared && a.owner_member_id === member.id) ?? [];
    const initDisp: Record<string, "transfer" | "joint"> = {};
    for (const acc of targetOwned) {
      initDisp[acc.id] = "transfer";
    }
    setDispositions(initDisp);
    setRemoveTarget(member);
  }

  async function handleConfirmTransfer() {
    if (!householdId || !transferTarget) return;
    setTransferError(null);
    setTransferPending(true);
    try {
      const res = await transferOwnership(householdId, transferTarget.id, demoteSelf);
      if (!res.ok) {
        setTransferError(res.errorKey);
      } else {
        setTransferTarget(null);
      }
    } catch {
      setTransferError("generic");
    } finally {
      setTransferPending(false);
    }
  }

  async function handleConfirmRemove() {
    if (!householdId || !removeTarget) return;
    setRemoveError(null);
    setRemovePending(true);
    try {
      const res = await removeMember(householdId, removeTarget.id, dispositions);
      if (!res.ok) {
        setRemoveError(res.errorKey);
      } else {
        setRemoveTarget(null);
      }
    } catch {
      setRemoveError("generic");
    } finally {
      setRemovePending(false);
    }
  }

  const targetAccounts = removeTarget
    ? (accounts.data?.filter((a) => a.is_shared && a.owner_member_id === removeTarget.id) ?? [])
    : [];

  const content = (
    <div className="space-y-6 p-4">
      <section aria-label={t("currentMembers")}>
        <h2 className="mb-2 text-sm font-medium">{t("currentMembers")}</h2>
        {members.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ) : (
          <ul className="divide-y">
            {(members.data ?? []).map((member) => {
              const isSelf = member.id === memberId;
              const isPartner = member.role === "partner";
              const canManageMember = isOwner && !isSelf;

              return (
                <li
                  key={member.id}
                  className="flex flex-wrap items-center justify-between py-2 text-sm gap-2"
                >
                  <span className="font-medium">{member.display_name}</span>
                  <div className="flex items-center gap-3">
                    {member.role === "owner" ? (
                      <span className="rounded-full border px-2 py-0.5 text-xs">
                        {t("roles.owner")}
                      </span>
                    ) : null}
                    <time dateTime={member.joined_at} className="text-muted-foreground">
                      {fmt.format(new Date(member.joined_at))}
                    </time>
                    {canManageMember ? (
                      <div className="flex items-center gap-1.5 ml-2">
                        {isPartner ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => handleOpenTransfer(member)}
                          >
                            {t("transferOwnership")}
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleOpenRemove(member)}
                        >
                          {t("removeMember")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label={t("pendingInvites")}>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium">{t("pendingInvites")}</h2>
          {invites.isPending ? (
            <Skeleton className="h-4 w-16" />
          ) : (
            <span className="text-xs text-muted-foreground">
              {t("count", { count: invites.data?.length ?? 0 })}
            </span>
          )}
        </div>

        {isOwner ? (
          <form action={handleInviteSubmit} className="mb-4 flex flex-col gap-2">
            <Label htmlFor="invite-email" className="sr-only">
              {t("inviteLabel")}
            </Label>
            <div className="flex gap-2">
              <Input
                id="invite-email"
                name="email"
                type="email"
                required
                placeholder={t("invitePlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? t("sending") : t("inviteButton")}
              </Button>
            </div>
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {tErrors(formError)}
              </p>
            ) : null}
          </form>
        ) : null}

        {actionError ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {tErrors(actionError)}
          </p>
        ) : null}

        {invites.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
          </div>
        ) : (invites.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noInvites")}</p>
        ) : (
          <ul className="divide-y">
            {(invites.data ?? []).map((invite) => {
              const expired = new Date(invite.expires_at) < new Date();
              return (
                <li key={invite.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <p className="flex items-center gap-2 font-medium">
                      {invite.email}
                      {expired ? (
                        <span className="rounded-full border px-2 py-0.5 text-xs text-destructive">
                          {t("expired")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("expires", { date: fmt.format(new Date(invite.expires_at)) })}
                    </p>
                  </div>
                  {isOwner ? (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResend(invite.id)}
                        disabled={resend.isPending && resend.variables === invite.id}
                      >
                        {t("resend")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleRevoke(invite.id)}
                        disabled={revoke.isPending && revoke.variables === invite.id}
                      >
                        {t("revoke")}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Transfer Ownership Modal */}
      <Dialog
        open={transferTarget !== null}
        onOpenChange={(open) => !open && setTransferTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <ShieldAlert className="size-5 text-amber-500" />
              {t("transferDialog.title", { name: transferTarget?.display_name ?? "" })}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {t("transferDialog.description", { name: transferTarget?.display_name ?? "" })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <label className="flex items-center gap-2 cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={demoteSelf}
                onChange={(e) => setDemoteSelf(e.target.checked)}
                className="rounded border"
              />
              {t("transferDialog.demoteSelf")}
            </label>

            {transferError ? (
              <p role="alert" className="text-sm text-destructive">
                {tErrors(transferError)}
              </p>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setTransferTarget(null)}
              disabled={transferPending}
            >
              {tCommon("cancel")}
            </Button>
            <Button onClick={handleConfirmTransfer} disabled={transferPending}>
              {transferPending ? t("transferDialog.transferring") : t("transferDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Modal */}
      <Dialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-destructive">
              <UserMinus className="size-5" />
              {t("removeDialog.title", { name: removeTarget?.display_name ?? "" })}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {targetAccounts.length > 0 ? (
              <div className="space-y-3 rounded-lg border p-3 text-xs bg-muted/30">
                <p className="font-medium text-foreground">
                  {t("removeDialog.ownedAccountsHeader", {
                    name: removeTarget?.display_name ?? "",
                    count: targetAccounts.length,
                  })}
                </p>
                <div className="space-y-2">
                  {targetAccounts.map((acc) => (
                    <div
                      key={acc.id}
                      className="flex flex-col gap-1 rounded border bg-background p-2"
                    >
                      <span className="font-medium text-foreground">{acc.name}</span>
                      <div className="flex gap-4 pt-1">
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                          <input
                            type="radio"
                            name={`disp-${acc.id}`}
                            checked={dispositions[acc.id] === "transfer"}
                            onChange={() =>
                              setDispositions((prev) => ({ ...prev, [acc.id]: "transfer" }))
                            }
                          />
                          {t("removeDialog.transferToMe")}
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                          <input
                            type="radio"
                            name={`disp-${acc.id}`}
                            checked={dispositions[acc.id] === "joint"}
                            onChange={() =>
                              setDispositions((prev) => ({ ...prev, [acc.id]: "joint" }))
                            }
                          />
                          {t("removeDialog.makeJoint")}
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1 text-muted-foreground">
              <p>
                {t("removeDialog.confirmationNotice", { name: removeTarget?.display_name ?? "" })}
              </p>
            </div>

            {removeError ? (
              <p role="alert" className="text-sm text-destructive">
                {tErrors(removeError)}
              </p>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setRemoveTarget(null)}
              disabled={removePending}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmRemove}
              disabled={removePending || targetAccounts.some((acc) => !dispositions[acc.id])}
            >
              {removePending
                ? t("removeDialog.removing")
                : t("removeDialog.confirm", { name: removeTarget?.display_name ?? "" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (embedded) return content;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}
