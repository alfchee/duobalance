import {
  HELP_ARTICLES,
  ALL_HELP_SLUGS,
  type Article,
  type ArticleFrontmatter,
} from "./generated-content";

export { ALL_HELP_SLUGS, type Article, type ArticleFrontmatter };

export function getArticle(locale: string, slug: string): Article | null {
  const normLocale = locale === "pt-BR" ? "pt-BR" : locale === "en" ? "en" : "es";
  const localeArticles = HELP_ARTICLES[normLocale] ?? HELP_ARTICLES["es"];
  if (localeArticles && localeArticles[slug]) {
    return localeArticles[slug];
  }
  const esArticles = HELP_ARTICLES["es"];
  if (esArticles && esArticles[slug]) return esArticles[slug];
  const enArticles = HELP_ARTICLES["en"];
  if (enArticles && enArticles[slug]) return enArticles[slug];
  return null;
}

export function getAllArticles(locale: string): Article[] {
  const normLocale = locale === "pt-BR" ? "pt-BR" : locale === "en" ? "en" : "es";
  const localeArticles = HELP_ARTICLES[normLocale] ?? HELP_ARTICLES["es"];
  return Object.values(localeArticles ?? {}).sort(
    (a, b) => a.frontmatter.order - b.frontmatter.order,
  );
}

export function getArticlesByCategory(locale: string): Record<string, Article[]> {
  const articles = getAllArticles(locale);
  const grouped: Record<string, Article[]> = {};
  for (const art of articles) {
    const cat = art.frontmatter.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(art);
  }
  return grouped;
}

export function searchArticles(locale: string, query: string): Article[] {
  const articles = getAllArticles(locale);
  const q = query.trim().toLowerCase();
  if (!q) return articles;

  return articles.filter((art) => {
    const titleMatch = art.frontmatter.title.toLowerCase().includes(q);
    const categoryMatch = art.frontmatter.category.toLowerCase().includes(q);
    const headingMatch = art.headings.some((h) => h.text.toLowerCase().includes(q));
    const contentMatch = art.content.toLowerCase().includes(q);
    return titleMatch || categoryMatch || headingMatch || contentMatch;
  });
}
