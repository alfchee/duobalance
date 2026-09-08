"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, FileText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { MarkdownRenderer } from "@/components/help/markdown-renderer";
import { getArticle } from "@/lib/help/help-service";
import { trackGuideOpen } from "@/lib/guide-events";
import { Card } from "@/components/ui/card";

export function HelpArticleClient({ slug }: { slug: string }) {
  const t = useTranslations("help");
  const locale = useLocale();
  const article = getArticle(locale, slug);

  // Deep-link support: scroll to hash fragment and record guide open for funnel.
  useEffect(() => {
    function scrollToHash() {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior: ScrollBehavior = prefersReducedMotion ? "auto" : "smooth";
      // Robust: retry until element found (handles hydration / slow PWA WebView)
      let attempts = 0;
      const tryScroll = () => {
        const el = document.getElementById(hash);
        if (el) {
          el.scrollIntoView({ behavior, block: "start" });
          return;
        }
        attempts += 1;
        if (attempts < 5) requestAnimationFrame(tryScroll);
      };
      requestAnimationFrame(() => requestAnimationFrame(tryScroll));
    }

    function onHashChange() {
      scrollToHash();
      // Track anchor navigation inside the same article (e.g. quick-entry → another anchor)
      const newAnchor = window.location.hash.slice(1) || null;
      void trackGuideOpen(`/help/${slug}${newAnchor ? `#${newAnchor}` : ""}`, "help-center");
    }

    scrollToHash();
    window.addEventListener("hashchange", onHashChange);

    // Record guide open on mount — slug + optional anchor. Dedupe in trackGuideOpen prevents double-count
    // with link onClick (empty-state → article). Note: this also counts direct/bookmark loads; intentional
    // for funnel coverage, but if #167 needs stricter "funnel-only" counting, gate this by referrer/source.
    const anchor = window.location.hash.slice(1) || null;
    void trackGuideOpen(`/help/${slug}${anchor ? `#${anchor}` : ""}`, "help-center");

    return () => window.removeEventListener("hashchange", onHashChange);
  }, [slug]);

  if (!article) {
    return (
      <main className="mx-auto w-full max-w-3xl p-4 sm:p-6 pb-20 md:pb-6">
        <Link
          href="/help"
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("backToHelp")}
        </Link>
        <Card className="mt-6 rounded-2xl p-8 text-center">
          <FileText className="mx-auto size-10 text-muted-foreground/60 mb-3" />
          <p className="text-lg font-bold">{t("noResults")}</p>
          <Link
            href="/help"
            className="mt-4 inline-block rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
          >
            {t("backToHelp")}
          </Link>
        </Card>
      </main>
    );
  }

  const categoryName = t(`categories.${article.frontmatter.category}` as Parameters<typeof t>[0]);

  const relatedArticles = article.frontmatter.related
    .map((relSlug) => getArticle(locale, relSlug))
    .filter((rel): rel is NonNullable<typeof rel> => rel !== null);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6 pb-20 md:pb-6">
      {/* Navigation */}
      <div>
        <Link
          href="/help"
          className="inline-flex items-center gap-2 rounded-full bg-secondary/80 px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          {t("backToHelp")}
        </Link>
      </div>

      {/* Article Header */}
      <article className="space-y-6">
        <div className="border-b pb-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-2">
            <span className="font-semibold text-primary">{categoryName}</span>
            <span>•</span>
            <span>{t("updatedOn", { date: article.frontmatter.updated })}</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">
            {article.frontmatter.title}
          </h1>
        </div>

        {/* Article Body — pre-rendered HTML at build time to avoid per-request CPU (p50 71ms → static) */}
        <div className="rounded-2xl border bg-card p-5 sm:p-8 shadow-sm">
          <MarkdownRenderer content={article.content} html={article.html} />
        </div>

        {/* Related Articles */}
        {relatedArticles.length > 0 ? (
          <section className="pt-6 border-t space-y-3">
            <h2 className="text-base font-bold tracking-tight">{t("relatedArticles")}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {relatedArticles.map((rel) => (
                <Link
                  key={rel.frontmatter.slug}
                  href={`/help/${rel.frontmatter.slug}`}
                  onClick={() =>
                    void trackGuideOpen(`/help/${rel.frontmatter.slug}`, "help-center")
                  }
                  className="group flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 transition-colors hover:bg-accent/40"
                >
                  <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2">
                    {rel.frontmatter.title}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </article>
    </main>
  );
}
