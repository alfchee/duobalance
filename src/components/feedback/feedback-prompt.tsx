"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { useHousehold } from "@/hooks/useHousehold";
import { useOfflineQueue } from "@/components/realtime-status";
import { collectDiagnosticContext } from "@/lib/diagnostics";
import { apiFetch } from "@/lib/api-fetch";
import { queueFeedbackReport } from "@/lib/offline-queue";
import { createSupabaseBrowser } from "@/lib/supabase/client";

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

export function FeedbackPrompt() {
  const t = useTranslations("feedback");
  const { user } = useSession();
  const { householdId, memberId, role, numberFormat, baseCurrency, timezone, locale } =
    useHousehold();
  const { queuedWrites, connectionState } = useOfflineQueue();

  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const key = `duobalance_feedback_dismissed_${user.id}`;
      if (localStorage.getItem(key) === "true") return;
    } catch {
      // Storage access blocked or unavailable
    }

    const createdAt = user.created_at ? new Date(user.created_at).getTime() : Date.now();
    const age = Date.now() - createdAt;

    if (age >= TWO_WEEKS_MS) {
      setVisible(true);
    }
  }, [user?.created_at, user?.id]);

  const handleDismiss = () => {
    if (user?.id) {
      try {
        localStorage.setItem(`duobalance_feedback_dismissed_${user.id}`, "true");
      } catch {
        // Storage access blocked or unavailable
      }
    }
    setVisible(false);
  };

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setIsSending(true);

    let accountCount = 0;
    let transactionCount = 0;

    if (householdId) {
      try {
        const supabase = createSupabaseBrowser();
        if (supabase) {
          const [accRes, txRes] = await Promise.all([
            supabase
              .from("accounts")
              .select("id", { count: "exact", head: true })
              .eq("household_id", householdId),
            supabase
              .from("transactions")
              .select("id", { count: "exact", head: true })
              .eq("household_id", householdId),
          ]);
          accountCount = accRes.count ?? 0;
          transactionCount = txRes.count ?? 0;
        }
      } catch {
        // Fallback to 0 counts on offline or query error
      }
    }

    const diagnostics = collectDiagnosticContext({
      householdId,
      memberId,
      role,
      locale,
      numberFormat,
      baseCurrency,
      timezone,
      accountCount,
      transactionCount,
      queuedWrites: queuedWrites.length,
      currentRoute: typeof window !== "undefined" ? window.location.pathname : "/",
    });

    const payload = {
      category: "satisfaction_prompt" as const,
      message,
      diagnostics,
    };

    const isOnline =
      connectionState === "online" && typeof navigator !== "undefined" && navigator.onLine;

    try {
      if (isOnline) {
        await apiFetch("/api/feedback", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else {
        throw new Error("offline");
      }
    } catch {
      if (householdId && user) {
        await queueFeedbackReport(crypto.randomUUID(), payload, {
          householdId,
          ownerUserId: user.id,
        });
      }
    } finally {
      setIsSending(false);
      setSubmitted(true);
      handleDismiss();
    }
  };

  if (!visible || submitted) return null;

  return (
    <div className="fixed bottom-20 right-4 z-40 max-w-sm rounded-xl border bg-card p-4 shadow-xl sm:bottom-6 sm:right-6">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("promptTitle")}</h3>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-xs p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("dismiss")}
        >
          <X className="size-4" />
        </button>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">{t("promptDescription")}</p>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t("messagePlaceholder")}
        rows={3}
        className="mt-3 w-full rounded-md border border-input bg-background p-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={handleDismiss}>
          {t("dismiss")}
        </Button>
        <Button
          size="sm"
          className="h-8 text-xs"
          onClick={handleSubmit}
          disabled={isSending || !message.trim()}
        >
          {isSending ? t("sending") : t("promptSubmit")}
        </Button>
      </div>
    </div>
  );
}
