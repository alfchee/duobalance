"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useHousehold } from "@/hooks/useHousehold";
import { useSession } from "@/hooks/useSession";
import { useOfflineQueue } from "@/components/realtime-status";
import { collectDiagnosticContext } from "@/lib/diagnostics";
import { apiFetch } from "@/lib/api-fetch";
import { queueFeedbackReport } from "@/lib/offline-queue";
import { createSupabaseBrowser } from "@/lib/supabase/client";

type ReportProblemModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lastError?: { message: string; stack?: string; at: string };
};

export function ReportProblemModal({ open, onOpenChange, lastError }: ReportProblemModalProps) {
  const t = useTranslations("feedback");
  const { householdId, memberId, role, numberFormat, baseCurrency, timezone, locale } =
    useHousehold();
  const { user } = useSession();
  const { queuedWrites, connectionState } = useOfflineQueue();

  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  async function getCounts() {
    if (!householdId) return { accountCount: 0, transactionCount: 0 };
    try {
      const supabase = createSupabaseBrowser();
      if (!supabase) return { accountCount: 0, transactionCount: 0 };

      const [accountsRes, txsRes] = await Promise.all([
        supabase
          .from("accounts")
          .select("id", { count: "exact", head: true })
          .eq("household_id", householdId),
        supabase
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("household_id", householdId),
      ]);

      return {
        accountCount: accountsRes.count ?? 0,
        transactionCount: txsRes.count ?? 0,
      };
    } catch {
      return { accountCount: 0, transactionCount: 0 };
    }
  }

  const handleSend = async () => {
    setIsSending(true);
    setStatusMessage(null);

    try {
      const counts = await getCounts();
      const diagnostics = collectDiagnosticContext({
        householdId,
        memberId,
        role,
        locale,
        numberFormat,
        baseCurrency,
        timezone,
        accountCount: counts.accountCount,
        transactionCount: counts.transactionCount,
        queuedWrites: queuedWrites.length,
        lastError,
        currentRoute: typeof window !== "undefined" ? window.location.pathname : "/",
      });

      const payload = {
        category: "problem_report" as const,
        message,
        diagnostics,
      };

      const isOnline =
        connectionState !== "offline" && typeof navigator !== "undefined" && navigator.onLine;

      if (isOnline) {
        await apiFetch("/api/feedback", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setStatusMessage(t("sent"));
      } else {
        throw new Error("offline");
      }
    } catch {
      const fallbackDiagnostics = collectDiagnosticContext({
        householdId,
        memberId,
        role,
        locale,
        numberFormat,
        baseCurrency,
        timezone,
        accountCount: 0,
        transactionCount: 0,
        queuedWrites: queuedWrites.length,
        lastError,
        currentRoute: typeof window !== "undefined" ? window.location.pathname : "/",
      });

      const payload = {
        category: "problem_report" as const,
        message,
        diagnostics: fallbackDiagnostics,
      };

      if (householdId && user) {
        await queueFeedbackReport(crypto.randomUUID(), payload, {
          householdId,
          ownerUserId: user.id,
        });
        setStatusMessage(t("queued"));
      } else {
        setStatusMessage(t("queued"));
      }
    } finally {
      setIsSending(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setMessage("");
        setStatusMessage(null);
        onOpenChange(false);
      }, 1800);
    }
  };

  const sampleDiagnostics = useMemo(
    () =>
      showDetails
        ? collectDiagnosticContext({
            householdId,
            memberId,
            role,
            locale,
            numberFormat,
            baseCurrency,
            timezone,
            accountCount: 0,
            transactionCount: 0,
            queuedWrites: queuedWrites.length,
            lastError,
          })
        : null,
    [
      showDetails,
      householdId,
      memberId,
      role,
      locale,
      numberFormat,
      baseCurrency,
      timezone,
      queuedWrites.length,
      lastError,
    ],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("messagePlaceholder")}
            rows={4}
            className="w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />

          <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">{t("noticeLine")}</p>

            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="mt-2 flex items-center gap-1 font-semibold text-primary hover:underline"
            >
              {showDetails ? t("hideIncluded") : t("seeWhatIncluded")}
              {showDetails ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </button>

            {showDetails ? (
              <pre className="mt-2 max-h-40 overflow-y-auto rounded bg-background p-2 font-mono text-[10px] text-foreground">
                {JSON.stringify(sampleDiagnostics, null, 2)}
              </pre>
            ) : null}
          </div>

          {statusMessage ? (
            <p className="text-center text-sm font-medium text-primary">{statusMessage}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSend} disabled={isSending}>
            {isSending ? t("sending") : t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
