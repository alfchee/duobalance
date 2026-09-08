"use client";

import { useLocale } from "next-intl";
import type { GuideHeading } from "@/lib/guide/generated-content";

export function TableOfContents({
  headings,
  locale: propLocale,
}: {
  headings: GuideHeading[];
  locale?: string;
}) {
  const browserLocale = useLocale();
  const locale = propLocale ?? browserLocale;
  const label =
    locale === "en" ? "In this guide" : locale === "pt-BR" ? "Neste guia" : "En esta guía";
  const ariaLabel = locale === "en" ? "Table of contents" : "Tabla de contenido";
  const tocHeadings = headings.filter((h) => h.level === 2 || h.level === 3);
  if (tocHeadings.length === 0) return null;

  return (
    <nav aria-label={ariaLabel} className="rounded-2xl border bg-card p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <ol className="mt-3 space-y-2">
        {tocHeadings.map((h) => (
          <li key={h.id} className={h.level === 3 ? "ml-4" : ""}>
            <a
              href={`#${h.id}`}
              className="text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
