import { describe, expect, it } from "vitest";
import { getAllArticles, getArticle, getArticlesByCategory, searchArticles } from "./help-service";

describe("help-service", () => {
  it("fetches articles by locale and slug", () => {
    const articleEs = getArticle("es", "ledger-vs-manual-balance");
    expect(articleEs).not.toBeNull();
    expect(articleEs?.frontmatter.slug).toBe("ledger-vs-manual-balance");

    const articleEn = getArticle("en", "ledger-vs-manual-balance");
    expect(articleEn).not.toBeNull();
    expect(articleEn?.frontmatter.slug).toBe("ledger-vs-manual-balance");
  });

  it("returns all articles for a locale", () => {
    const articles = getAllArticles("es");
    expect(articles.length).toBeGreaterThan(0);
    expect(articles[0]?.frontmatter.order).toBeLessThanOrEqual(
      articles[articles.length - 1]?.frontmatter.order ?? 100,
    );
  });

  it("groups articles by category", () => {
    const grouped = getArticlesByCategory("es");
    expect(grouped.accounts).toBeDefined();
    expect(grouped.accounts?.length).toBeGreaterThan(0);
  });

  it("searches articles by query string", () => {
    const results = searchArticles("es", "saldo");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((a) => a.frontmatter.slug === "ledger-vs-manual-balance")).toBe(true);
  });
});
