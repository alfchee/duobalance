"use client";

// useTranslations works here because the root layout's <Providers>
// (LocaleProvider) stays mounted around this error boundary.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ReportProblemModal } from "@/components/feedback/report-problem-modal";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  const tFeedback = useTranslations("feedback");
  const [reportModalOpen, setReportModalOpen] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">{t("somethingWrong")}</h1>
      <p className="text-sm text-muted-foreground">{t("unknownError")}</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => reset()}>{t("retry")}</Button>
        <Button variant="outline" onClick={() => setReportModalOpen(true)}>
          {tFeedback("reportProblem")}
        </Button>
      </div>

      <ReportProblemModal
        open={reportModalOpen}
        onOpenChange={setReportModalOpen}
        lastError={{
          message: error?.message || "Unknown error",
          stack: error?.stack,
          at: new Date().toISOString(),
        }}
      />
    </main>
  );
}
