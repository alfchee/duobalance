"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Globe } from "lucide-react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/help/markdown-renderer";
import { PRIVACY_POLICY } from "@/lib/legal/privacy";

export default function PrivacyPage() {
  const currentLocale = useLocale();
  const [selectedLang, setSelectedLang] = useState<"es" | "en">(
    currentLocale === "en" ? "en" : "es",
  );

  const doc = PRIVACY_POLICY[selectedLang] ?? PRIVACY_POLICY.es;

  return (
    <main className="mx-auto min-h-dvh max-w-4xl p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <Button variant="ghost" size="sm" asChild className="gap-2 text-muted-foreground">
          <Link href="/">
            <ArrowLeft className="size-4" />
            <span>{selectedLang === "es" ? "Volver" : "Back"}</span>
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          <div className="inline-flex rounded-lg border bg-muted p-1 text-xs">
            <button
              type="button"
              onClick={() => setSelectedLang("es")}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                selectedLang === "es"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Español (Oficial)
            </button>
            <button
              type="button"
              onClick={() => setSelectedLang("en")}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                selectedLang === "en"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              English
            </button>
          </div>
        </div>
      </header>

      <Card className="border-0 shadow-raised sm:border sm:shadow-sm">
        <CardHeader className="gap-2 p-6 pb-4 sm:p-8 sm:pb-6">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
            <span>
              {selectedLang === "es" ? "Versión" : "Version"} {doc.version}
            </span>
            <span>{doc.effectiveDate}</span>
          </div>
          <CardTitle className="text-3xl font-black tracking-tight">{doc.title}</CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-0 sm:p-8 sm:pt-0">
          <MarkdownRenderer content={doc.content} />
        </CardContent>
      </Card>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground border-t pt-4">
        <p>© {new Date().getFullYear()} DuoBalance</p>
        <div className="flex gap-4">
          <Link href="/terms" className="hover:underline">
            {selectedLang === "es" ? "Términos de Servicio" : "Terms of Service"}
          </Link>
          <Link href="/" className="hover:underline">
            {selectedLang === "es" ? "Inicio" : "Home"}
          </Link>
        </div>
      </footer>
    </main>
  );
}
