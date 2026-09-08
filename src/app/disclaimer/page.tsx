import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Disclaimer — educational content — DuoBalance",
  description:
    "Disclaimer for DuoBalance educational content: not financial advice and when to consult a professional.",
  alternates: { canonical: "https://duobalanceapp.com/disclaimer" },
};

export default function DisclaimerPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to home
      </Link>
      <article className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">Disclaimer — educational content</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Effective September 8, 2026.
        </p>
        <div className="rounded-2xl border bg-card p-5 sm:p-8 space-y-4 text-sm leading-relaxed">
          <p>
            DuoBalance is not a certified financial adviser. Guide and lesson content covers
            general, widely accepted principles for organizing and understanding your spending; it
            is not financial, legal or tax advice.
          </p>
          <p>
            Every household&apos;s situation is different. For decisions about debt, loans,
            investments, business or taxes, talk to a qualified professional who can review your
            circumstances and the regulations in your country.
          </p>
          <p>
            If you spot an error or a recommendation that doesn&apos;t match local best practice,
            email us at{" "}
            <a
              href="mailto:hola@duobalanceapp.com"
              className="font-semibold text-primary underline"
            >
              hola@duobalanceapp.com
            </a>
            .
          </p>
        </div>
      </article>
    </main>
  );
}
