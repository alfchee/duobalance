"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FeatureGate, UpgradePrompt } from "@/components/billing/feature-gate";
import { useHousehold } from "@/hooks/useHousehold";
import { apiFetch, ApiError } from "@/lib/api-fetch";

type ExportFormat = "json" | "csv";

export function downloadFilename(
  householdName: string,
  format: ExportFormat,
  now: Date = new Date(),
): string {
  const date = now.toISOString().slice(0, 10);
  const household =
    householdName
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "")
      .slice(0, 80) || "household";
  return `duobalance-${household}-${date}.${format}`;
}

export function ExportSection() {
  const t = useTranslations("settings.export");
  const { householdId, householdName } = useHousehold();
  const [pending, setPending] = useState<ExportFormat | null>(null);
  // Defense-in-depth: the FeatureGate below hides the buttons while the
  // plan lacks `export`, and /api/export re-checks has_feature() server-side
  // (#264). A 402 from that check (gate open, plan changed mid-session)
  // still lands on the upgrade prompt instead of a dead error.
  const [planBlocked, setPlanBlocked] = useState(false);
  const [error, setError] = useState(false);
  // Time-limited link (#269): minted server-side, 256-bit token, 24h expiry.
  const [linkPending, setLinkPending] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [link, setLink] = useState<{ url: string; expires_at: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function download(format: ExportFormat) {
    setPending(format);
    setError(false);
    setPlanBlocked(false);
    try {
      const blob = await apiFetch<Blob>(`/api/export?format=${format}&householdId=${householdId}`, {
        responseType: "blob",
      });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = downloadFilename(householdName ?? "household", format);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) setPlanBlocked(true);
      else setError(true);
    } finally {
      setPending(null);
    }
  }

  async function createLink() {
    if (!householdId) return;
    setLinkPending(true);
    setLinkError(false);
    setPlanBlocked(false);
    setCopied(false);
    try {
      const res = await apiFetch<{ url: string; expires_at: string }>("/api/exports", {
        method: "POST",
        body: { householdId, format: "json" },
      });
      setLink({ url: res.url, expires_at: res.expires_at });
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) setPlanBlocked(true);
      else setLinkError(true);
    } finally {
      setLinkPending(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setLinkError(true);
    }
  }

  return (
    <section className="space-y-3 px-4 py-4">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("error")}
        </p>
      ) : null}
      <FeatureGate householdId={householdId} feature="export">
        {planBlocked ? (
          <UpgradePrompt />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!householdId || pending !== null}
                onClick={() => void download("json")}
              >
                <Download aria-hidden />
                {pending === "json" ? t("exporting") : t("json")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!householdId || pending !== null}
                onClick={() => void download("csv")}
              >
                <Download aria-hidden />
                {pending === "csv" ? t("exporting") : t("csv")}
              </Button>
            </div>
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">{t("linkDescription")}</p>
              {linkError ? (
                <p role="alert" className="text-sm text-destructive">
                  {t("linkError")}
                </p>
              ) : null}
              {link ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {t("linkExpires", { date: link.expires_at })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => void copyLink()}>
                      {copied ? t("copied") : t("copyLink")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setLink(null)}>
                      {t("dismissLink")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!householdId || linkPending}
                  onClick={() => void createLink()}
                >
                  {linkPending ? t("exporting") : t("createLink")}
                </Button>
              )}
            </div>
          </div>
        )}
      </FeatureGate>
    </section>
  );
}
