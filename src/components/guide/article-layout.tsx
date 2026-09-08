"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Clock, ArrowLeft, Calendar } from "lucide-react";
import { useLocale } from "next-intl";
import type { GuideArticle } from "@/lib/guide/generated-content";
import { trackGuideOpen } from "@/lib/guide-events";
import { MarkdownRenderer } from "@/components/help/markdown-renderer";
import { TableOfContents } from "./table-of-contents";
import { EducationalDisclaimer } from "./educational-disclaimer";

export function GuideArticleLayout({
  article,
  backHref = "/",
  backLabel = "Volver al inicio",
  locale: contentLocale,
}: {
  article: GuideArticle;
  backHref?: string;
  backLabel?: string;
  locale?: string;
}) {
  const { frontmatter, headings, content } = article;
  const browserLocale = useLocale();
  // Content locale drives labels/links; fallback to browser locale for backwards compat.
  const locale = contentLocale ?? browserLocale;
  // Explicit locale branching so pt-BR does not silently inherit Spanish.
  // TODO(#191): add dedicated pt-BR guide route (/guia-pt or /guia) and switch relatedBase.
  const readingLabel =
    locale === "en" ? "min read" : locale === "pt-BR" ? "min de leitura" : "min de lectura";
  const relatedBase = locale === "en" ? "/guide" : "/guia";
  const nextLabel = locale === "en" ? "Next" : locale === "pt-BR" ? "Próximo" : "Siguiente";

  const guideHref = `${relatedBase}/${frontmatter.slug}`;
  const trackedDepths = useRef<Set<number>>(new Set());

  // Guide view + scroll-depth analytics (#197)
  useEffect(() => {
    trackedDepths.current.clear();
    void trackGuideOpen(guideHref, "guide-view");

    function onScroll() {
      const scrollTop = window.scrollY;
      const viewportHeight = window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;
      const thresholds = [25, 50, 75, 100] as const;
      let depth: number;
      if (docHeight <= viewportHeight) {
        depth = 100;
      } else {
        depth = Math.ceil(((scrollTop + viewportHeight) / docHeight) * 100);
        if (depth > 100) depth = 100;
      }
      for (const t of thresholds) {
        // 100 handled as >=99 to survive sub-pixel/zoom cases
        const reached = t === 100 ? depth >= 99 : depth >= t;
        if (reached && !trackedDepths.current.has(t)) {
          trackedDepths.current.add(t);
          void trackGuideOpen(`${guideHref}#depth-${t}`, "guide-scroll");
        }
      }
    }
    let ticking = false;
    function throttledOnScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        onScroll();
        ticking = false;
      });
    }
    window.addEventListener("scroll", throttledOnScroll, { passive: true });
    // Fire once to emit 100% for short articles and initial viewport
    onScroll();
    return () => window.removeEventListener("scroll", throttledOnScroll);
  }, [guideHref]);

  // Deep-link / hash scroll support, mirrors help-article-client
  useEffect(() => {
    function scrollToHash() {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      void trackGuideOpen(`${guideHref}#${hash}`, "guide-anchor");
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior: ScrollBehavior = prefersReducedMotion ? "auto" : "smooth";
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
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, [guideHref]);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6 pb-20">
      <Link
        href={backHref}
        className="inline-flex items-center gap-2 rounded-full bg-secondary/80 px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        {backLabel}
      </Link>

      <article className="space-y-6">
        <header className="space-y-3 border-b pb-6">
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{frontmatter.title}</h1>
          {frontmatter.description ? (
            <p className="text-base leading-relaxed text-muted-foreground">
              {frontmatter.description}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {frontmatter.readingTime} {readingLabel}
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              {frontmatter.updated}
            </span>
          </div>
        </header>

        <TableOfContents headings={headings} locale={locale} />

        <div className="rounded-2xl border bg-card p-5 sm:p-8 shadow-sm">
          {/* Pre-rendered HTML from build-guide-content.mjs avoids per-request markdown parsing */}
          {article.html ? (
            <div dangerouslySetInnerHTML={{ __html: article.html }} />
          ) : (
            <MarkdownRenderer content={content} />
          )}
        </div>

        {/* Disclaimer slot — cannot be omitted; layout always renders it */}
        <EducationalDisclaimer locale={locale} />

        {frontmatter.related.length > 0 ? (
          <section className="rounded-2xl border bg-muted/20 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {nextLabel}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {frontmatter.related.map((slug) => (
                <Link
                  key={slug}
                  href={`${relatedBase}/${slug}`}
                  className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-accent"
                >
                  {slug}
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </article>
    </main>
  );
}
