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
  if (esArticles && esArticles[slug]) {
    console.warn(`help: no "${slug}" article for locale "${normLocale}", falling back to "es"`);
    return esArticles[slug];
  }
  const enArticles = HELP_ARTICLES["en"];
  if (enArticles && enArticles[slug]) {
    console.warn(
      `help: no "${slug}" article for locale "${normLocale}" or "es", falling back to "en"`,
    );
    return enArticles[slug];
  }
  console.warn(`help: no article found for slug "${slug}" in any locale`);
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

  // Lowercase index computed once per article (not per keystroke): the
  // previous filter lowercased title + category + every heading + the full
  // body on each call, i.e. per keystroke.
  const index = getSearchIndex(locale);
  return articles.filter((art) => (index.get(art.frontmatter.slug) ?? "").includes(q));
}

const searchIndexCache = new Map<string, Map<string, string>>();

function getSearchIndex(locale: string): Map<string, string> {
  const normLocale = locale === "pt-BR" ? "pt-BR" : locale === "en" ? "en" : "es";
  const cached = searchIndexCache.get(normLocale);
  if (cached) return cached;
  const index = new Map<string, string>();
  for (const art of getAllArticles(normLocale)) {
    index.set(
      art.frontmatter.slug,
      [
        art.frontmatter.title,
        art.frontmatter.category,
        ...art.headings.map((h) => h.text),
        art.content,
      ]
        .join("\n")
        .toLowerCase(),
    );
  }
  searchIndexCache.set(normLocale, index);
  return index;
}
