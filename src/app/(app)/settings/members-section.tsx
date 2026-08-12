"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdMembers } from "@/hooks/useHouseholdMembers";
import { useInviteMutations, usePendingInvites } from "@/hooks/useInvites";

function dateFormatter(locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
}

export function MembersSection({ embedded = false }: { embedded?: boolean }) {
  const { householdId, role } = useHousehold();
  const t = useTranslations("settings.members");
  const tErrors = useTranslations("settings.members.errors");
  const locale = useLocale();

  const isOwner = role === "owner";

  const members = useHouseholdMembers(householdId);
  const invites = usePendingInvites(householdId);
  const { create, revoke, resend } = useInviteMutations(householdId);

  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
      // List is refreshed via query invalidation; a failed revoke leaves the
      // invite visible so the owner can retry.
      setActionError(inviteErrorKey(err));
    }
  }

  async function handleResend(inviteId: string) {
    setActionError(null);
    try {
      await resend.mutateAsync(inviteId);
    } catch (err) {
      // Same as revoke — keep the row so the owner can retry.
      setActionError(inviteErrorKey(err));
    }
  }

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
            {(members.data ?? []).map((member) => (
              <li key={member.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium">{member.display_name}</span>
                <span className="flex items-center gap-3 text-muted-foreground">
                  {member.role === "owner" ? (
                    <span className="rounded-full border px-2 py-0.5 text-xs">
                      {t("roles.owner")}
                    </span>
                  ) : null}
                  <time dateTime={member.joined_at}>{fmt.format(new Date(member.joined_at))}</time>
                </span>
              </li>
            ))}
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
