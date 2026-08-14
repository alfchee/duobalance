"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useHousehold } from "@/hooks/useHousehold";
import { apiFetch } from "@/lib/api-fetch";

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
  const [error, setError] = useState(false);

  async function download(format: ExportFormat) {
    setPending(format);
    setError(false);
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
    } catch {
      setError(true);
    } finally {
      setPending(null);
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
    </section>
  );
}
