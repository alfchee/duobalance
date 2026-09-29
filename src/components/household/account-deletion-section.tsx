"use client";

// Self-service account deletion with explicit confirmation + 30-day grace
// (#269). Flow: no request → request → pending (type email to confirm) →
// confirmed (grace countdown, cancellable) → purged (anonymized, irreversible).
// Purge anonymizes memberships in place; transactions are never mutated, so
// the household's books still balance. See docs/data-export-deletion.md.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/useSession";
import { apiFetch, ApiError } from "@/lib/api-fetch";
import type { AccountDeletionRequest } from "@/lib/account-deletion";

type StatusResponse = { request: AccountDeletionRequest | null };

export function AccountDeletionSection() {
  const t = useTranslations("settings.accountDeletion");
  const tCommon = useTranslations("common");
  const { user } = useSession();

  const [request, setRequest] = useState<AccountDeletionRequest | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [typedEmail, setTypedEmail] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch<StatusResponse>("/api/account/deletion-status");
      setRequest(res.request);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(fn: () => Promise<StatusResponse | { request: AccountDeletionRequest }>) {
    setIsPending(true);
    setActionError(null);
    try {
      const res = await fn();
      setRequest(res.request);
      setConfirmOpen(false);
      setTypedEmail("");
    } catch (err) {
      setActionError(mapApiError(err));
    } finally {
      setIsPending(false);
    }
  }

  function mapApiError(err: unknown): string {
    if (err instanceof ApiError && typeof err.body === "object" && err.body !== null) {
      const code = (err.body as { error?: string }).error ?? "";
      if (code.includes("already requested")) return "alreadyRequested";
      if (code.includes("does not match")) return "emailMismatch";
      if (code.includes("no pending")) return "noPending";
      if (code.includes("no open")) return "noOpen";
    }
    return "generic";
  }

  const emailMatches = (user?.email ?? "").toLowerCase() === typedEmail.trim().toLowerCase();

  return (
    <section className="space-y-3 px-4 py-4">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("loadError")}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${actionError}`)}
        </p>
      ) : null}

      {request === undefined && !loadError ? (
        <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
      ) : null}

      {request === null ? (
        <div className="space-y-2">
          {!confirmOpen ? (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {t("requestButton")}
            </Button>
          ) : (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t("requestNotice")}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    void run(() =>
                      apiFetch<{ request: AccountDeletionRequest }>(
                        "/api/account/deletion-request",
                        { method: "POST", body: {} },
                      ),
                    )
                  }
                >
                  {isPending ? t("requesting") : t("confirmRequestButton")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setConfirmOpen(false)}
                >
                  {tCommon("cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {request && request.status === "pending" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("pendingNotice")}</p>
          <div className="space-y-2">
            <Label htmlFor="account-deletion-email" className="text-xs font-medium">
              {t("emailPrompt", { email: user?.email ?? "" })}
            </Label>
            <Input
              id="account-deletion-email"
              type="email"
              autoComplete="off"
              value={typedEmail}
              onChange={(e) => setTypedEmail(e.target.value)}
              placeholder={user?.email ?? ""}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={isPending || !emailMatches}
              onClick={() =>
                void run(() =>
                  apiFetch<{ request: AccountDeletionRequest }>("/api/account/deletion-confirm", {
                    method: "POST",
                    body: { email: typedEmail.trim() },
                  }),
                )
              }
            >
              {isPending ? t("confirming") : t("confirmButton")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                void run(() =>
                  apiFetch<{ request: AccountDeletionRequest }>("/api/account/deletion-cancel", {
                    method: "POST",
                    body: {},
                  }),
                )
              }
            >
              {t("cancelButton")}
            </Button>
          </div>
        </div>
      ) : null}

      {request && request.status === "confirmed" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("graceNotice", { date: request.scheduled_purge_at ?? "" })}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              void run(() =>
                apiFetch<{ request: AccountDeletionRequest }>("/api/account/deletion-cancel", {
                  method: "POST",
                  body: {},
                }),
              )
            }
          >
            {t("cancelButton")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
