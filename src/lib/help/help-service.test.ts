import { describe, expect, it, vi } from "vitest";
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

  it("normalizes an unrecognized locale to the Spanish article set", () => {
    const result = getArticle("fr", "ledger-vs-manual-balance");
    expect(result?.frontmatter.slug).toBe("ledger-vs-manual-balance");
  });

  it("returns null and warns for a slug that doesn't exist in any locale", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = getArticle("es", "this-slug-does-not-exist");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no article found for slug "this-slug-does-not-exist"'),
    );
    warnSpy.mockRestore();
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
