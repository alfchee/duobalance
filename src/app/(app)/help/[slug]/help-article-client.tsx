"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, FileText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { MarkdownRenderer } from "@/components/help/markdown-renderer";
import { getArticle } from "@/lib/help/help-service";
import { Card } from "@/components/ui/card";

export function HelpArticleClient({ slug }: { slug: string }) {
  const t = useTranslations("help");
  const locale = useLocale();
  const article = getArticle(locale, slug);

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

        {/* Article Body */}
        <div className="rounded-2xl border bg-card p-5 sm:p-8 shadow-sm">
          <MarkdownRenderer content={article.content} />
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
