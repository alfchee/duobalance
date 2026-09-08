import {
  GUIDE_ARTICLES,
  ALL_GUIDE_SLUGS,
  GUIDE_SLUGS_BY_LOCALE,
  type GuideArticle,
  type GuideFrontmatter,
} from "./generated-content";

export { ALL_GUIDE_SLUGS, GUIDE_SLUGS_BY_LOCALE, type GuideArticle, type GuideFrontmatter };

function normalizeLocale(locale: string): string {
  if (locale === "pt-BR") return "pt-BR";
  if (locale === "en") return "en";
  return "es";
}

export function getGuideArticle(locale: string, slug: string): GuideArticle | null {
  const norm = normalizeLocale(locale);
  const localeArticles = GUIDE_ARTICLES[norm] ?? GUIDE_ARTICLES["es"];
  if (localeArticles && localeArticles[slug]) return localeArticles[slug];
  // Fallback to Spanish then English
  const esArticles = GUIDE_ARTICLES["es"];
  if (esArticles && esArticles[slug]) {
    console.warn(`guide: no "${slug}" for locale "${norm}", fallback to "es"`);
    return esArticles[slug];
  }
  const enArticles = GUIDE_ARTICLES["en"];
  if (enArticles && enArticles[slug]) {
    console.warn(`guide: no "${slug}" for "${norm}" or "es", fallback to "en"`);
    return enArticles[slug];
  }
  console.warn(`guide: no article for slug "${slug}"`);
  return null;
}

export function getAllGuideArticles(locale: string): GuideArticle[] {
  const norm = normalizeLocale(locale);
  const localeArticles = GUIDE_ARTICLES[norm] ?? GUIDE_ARTICLES["es"];
  return Object.values(localeArticles ?? {}).sort(
    (a, b) => a.frontmatter.order - b.frontmatter.order,
  );
}

export function getGuideSlugsForLocale(locale: string): string[] {
  const norm = normalizeLocale(locale);
  return GUIDE_SLUGS_BY_LOCALE[norm] ?? GUIDE_SLUGS_BY_LOCALE["es"] ?? [];
}

export function getAllGuideSlugs(): string[] {
  return ALL_GUIDE_SLUGS;
}
