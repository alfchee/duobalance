"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Search,
  ChevronRight,
  BookOpen,
  Wallet,
  ArrowLeftRight,
  PieChart,
  Receipt,
  BarChart3,
  Settings,
  HelpCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { searchArticles, getArticlesByCategory, type Article } from "@/lib/help/help-service";
import { trackGuideOpen } from "@/lib/guide-events";

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  accounts: Wallet,
  transactions: ArrowLeftRight,
  budgets: PieChart,
  bills: Receipt,
  reports: BarChart3,
  settings: Settings,
  general: BookOpen,
};

export default function HelpPage() {
  const t = useTranslations("help");
  const locale = useLocale();
  const [query, setQuery] = useState("");

  const isSearching = query.trim().length > 0;
  const searchResults = isSearching ? searchArticles(locale, query) : [];
  const groupedArticles = getArticlesByCategory(locale);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("title")}</h1>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 rounded-full border bg-card pl-10 pr-4 text-sm shadow-sm transition-colors focus-visible:ring-2"
        />
      </div>

      {/* Starter guide — persistent entry point, 1 tap from any main screen via Help (2 taps total: Help → guide) */}
      {!isSearching ? (
        <Link
          href={t("starterHref")}
          onClick={() => void trackGuideOpen(t("starterHref"), "help-center")}
          className="flex items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-4 transition-colors hover:bg-primary/10"
        >
          <div className="min-w-0">
            <p className="text-sm font-black tracking-tight text-primary">{t("starterTitle")}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {t("starterDescription")}
            </p>
            <p className="mt-2 text-xs font-semibold text-primary">{t("starterCta")}</p>
          </div>
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <BookOpen className="size-5" />
          </span>
        </Link>
      ) : null}

      {/* Search Results Mode */}
      {isSearching ? (
        <section className="space-y-3">
          {searchResults.length > 0 ? (
            <div className="space-y-2">
              {searchResults.map((article) => (
                <ArticleRow
                  key={article.frontmatter.slug}
                  article={article}
                  categoryName={t(
                    `categories.${article.frontmatter.category}` as Parameters<typeof t>[0],
                  )}
                />
              ))}
            </div>
          ) : (
            <Card className="rounded-2xl p-8 text-center text-muted-foreground">
              <HelpCircle className="mx-auto size-8 text-muted-foreground/60 mb-2" />
              <p className="text-sm font-medium">{t("noResults")}</p>
            </Card>
          )}
        </section>
      ) : (
        /* Grouped Categories Mode */
        <div className="space-y-8">
          {Object.entries(groupedArticles).map(([category, articles]) => {
            const Icon = CATEGORY_ICONS[category] ?? BookOpen;
            const categoryLabel = t(`categories.${category}` as Parameters<typeof t>[0]);

            return (
              <section key={category} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </span>
                  <h2 className="text-lg font-bold tracking-tight">{categoryLabel}</h2>
                </div>

                <div className="space-y-2">
                  {articles.map((article) => (
                    <ArticleRow
                      key={article.frontmatter.slug}
                      article={article}
                      categoryName={categoryLabel}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

function ArticleRow({ article, categoryName }: { article: Article; categoryName: string }) {
  const href = `/help/${article.frontmatter.slug}`;
  return (
    <Link
      href={href}
      onClick={() => void trackGuideOpen(href, "help-center")}
      className="group flex items-center justify-between gap-4 rounded-2xl border bg-card p-4 transition-colors hover:bg-accent/40"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
          {article.frontmatter.title}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{categoryName}</p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
    </Link>
  );
}
