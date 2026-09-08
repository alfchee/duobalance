import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { getAllGuideArticles } from "@/lib/guide/guide-service";
import { EducationalDisclaimer } from "@/components/guide/educational-disclaimer";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Guide — DuoBalance",
  description: "Short guides to get your finances in order with DuoBalance. Start with the basics.",
  alternates: { canonical: "https://duobalanceapp.com/guide" },
  openGraph: {
    title: "Guide — DuoBalance",
    description: "Short guides to get your finances in order with DuoBalance.",
    url: "https://duobalanceapp.com/guide",
    type: "website",
    siteName: "DuoBalance",
    locale: "en_US",
  },
};

export default function GuideIndexPage() {
  const articles = getAllGuideArticles("en");
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-black tracking-tight">Guide</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Short guides to get your finances in order. Start with the basics and leave budgets for
          later.
        </p>
      </header>
      <section className="grid gap-3">
        {articles.map((a) => (
          <Link
            key={a.frontmatter.slug}
            href={`/guide/${a.frontmatter.slug}`}
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
      <EducationalDisclaimer locale="en" />
    </main>
  );
}
