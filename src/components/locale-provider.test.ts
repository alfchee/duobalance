import { describe, expect, it } from "vitest";
import { mergeMessages, toSupportedLocale } from "./locale-provider";
import en from "@/messages/en.json";
import ptBR from "@/messages/pt-BR.json";

describe("toSupportedLocale", () => {
  it.each([
    ["en", "en"],
    ["en-US", "en"],
    ["EN-gb", "en"],
    ["pt", "pt-BR"],
    ["pt-PT", "pt-BR"],
    ["pt-BR", "pt-BR"],
    ["es-MX", "es"],
    [null, "es"],
  ] as const)("normalizes %s to %s", (locale, expected) => {
    expect(toSupportedLocale(locale)).toBe(expected);
  });
});

describe("mergeMessages", () => {
  it("falls back to the base value for a key missing from overrides, at any nesting depth", () => {
    const base = { a: "base-a", nested: { x: "base-x", y: "base-y" } };
    const overrides = { nested: { y: "override-y" } };

    expect(mergeMessages(base, overrides)).toEqual({
      a: "base-a",
      nested: { x: "base-x", y: "override-y" },
    });
  });

  it("prefers the override value for a plain scalar key", () => {
    const base = { greeting: "hello" };
    const overrides = { greeting: "olá" };

    expect(mergeMessages(base, overrides)).toEqual({ greeting: "olá" });
  });

  it("replaces an array wholesale instead of merging it index-by-index", () => {
    const base = { items: ["a", "b", "c"] };
    const overrides = { items: ["x"] };

    expect(mergeMessages(base, overrides)).toEqual({ items: ["x"] });
  });

  it("does not treat an array override for an object base key as mergeable", () => {
    const base = { value: { nested: "base" } };
    const overrides = { value: ["not", "an", "object"] };

    expect(mergeMessages(base, overrides)).toEqual({ value: ["not", "an", "object"] });
  });

  it("does not merge into an array base value even when the override is a plain object", () => {
    const base = { value: ["a", "b"] };
    const overrides = { value: { 0: "x" } };

    expect(mergeMessages(base, overrides)).toEqual({ value: { 0: "x" } });
  });

  it("treats null override values as scalars, not mergeable objects", () => {
    const base = { value: { nested: "base" } };
    const overrides = { value: null };

    expect(mergeMessages(base, overrides)).toEqual({ value: null });
  });

  it("falls back to English for every pt-BR key still untranslated in the real catalogs", () => {
    const merged = mergeMessages(en, ptBR) as { pwa: { push: { error: string } } };
    // pwa.push.error was added straight to en/es and intentionally left out of
    // pt-BR — this is exactly the untranslated-key fallback path in production.
    expect(merged.pwa.push.error).toBe(en.pwa.push.error);
  });
});
