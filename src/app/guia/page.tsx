import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { getAllGuideArticles } from "@/lib/guide/guide-service";
import { EducationalDisclaimer } from "@/components/guide/educational-disclaimer";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Guía — DuoBalance",
  description: "Guías breves para ordenar tus finanzas con DuoBalance. Empieza por lo esencial.",
  alternates: { canonical: "https://duobalanceapp.com/guia" },
  openGraph: {
    title: "Guía — DuoBalance",
    description: "Guías breves para ordenar tus finanzas con DuoBalance.",
    url: "https://duobalanceapp.com/guia",
    type: "website",
    siteName: "DuoBalance",
    locale: "es_NI",
  },
};

export default function GuiaIndexPage() {
  const articles = getAllGuideArticles("es");
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-black tracking-tight">Guía</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Guías breves para ordenar tus finanzas. Empieza por lo esencial y deja los presupuestos
          para después.
        </p>
      </header>
      <section className="grid gap-3">
        {articles.map((a) => (
          <Link
            key={a.frontmatter.slug}
            href={`/guia/${a.frontmatter.slug}`}
            className="rounded-2xl border bg-card p-4 hover:bg-accent/40 transition-colors"
          >
            <p className="text-sm font-bold">{a.frontmatter.title}</p>
            {a.frontmatter.description ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {a.frontmatter.description}
              </p>
            ) : null}
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              {a.frontmatter.readingTime} min
            </p>
          </Link>
        ))}
      </section>
      <EducationalDisclaimer locale="es" />
    </main>
  );
}
