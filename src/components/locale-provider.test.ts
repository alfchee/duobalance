import { describe, expect, it } from "vitest";
import { toSupportedLocale } from "./locale-provider";

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
