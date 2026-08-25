import { describe, expect, it } from "vitest";
import {
  formatMoneyInput,
  formatMoney,
  formatSignedMoney,
  maskMoneyInput,
  parseMoneyInput,
  roundToMinorUnit,
} from "./money";

// The AC is about decimal count and separator, not grouping or symbol —
// the CLP symbol renders "$" in browsers/full-icu and "CLP" in a trimmed
// build, so assertions avoid the symbol and grouping entirely.
describe("formatMoney", () => {
  it.each([
    ["USD", "en"],
    ["NIO", "es"],
    ["CLP", "es"],
    ["BRL", "pt-BR"],
  ] as const)("keeps %s currency precision with every preference", (currency, locale) => {
    const localeFormat = formatMoney(1234.5, currency, locale);
    const dotDecimal = formatMoney(1234.5, currency, locale, "dot_decimal");
    const commaDecimal = formatMoney(1234.5, currency, locale, "comma_decimal");
    const decimals = currency === "CLP" ? 0 : 2;

    if (decimals === 0) {
      expect(localeFormat.replace(/\D/g, "")).toBe("1235");
      expect(dotDecimal.replace(/\D/g, "")).toBe("1235");
      expect(commaDecimal.replace(/\D/g, "")).toBe("1235");
    } else {
      expect(localeFormat).toMatch(/[.,]50/);
      expect(dotDecimal).toMatch(/\.50/);
      expect(commaDecimal).toMatch(/,50/);
    }
  });
  it("renders CLP with 0 decimals (no minimumFractionDigits override)", () => {
    // es uses "," as the decimal separator, so its absence proves 0 decimals.
    expect(formatMoney(1234.5, "CLP", "es")).not.toContain(",");
  });

  it("renders USD with 2 decimals", () => {
    expect(formatMoney(1234, "USD", "en")).toMatch(/\.00$/);
  });

  it("renders BRL with 2 decimals and comma decimal in pt-BR", () => {
    expect(formatMoney(1234, "BRL", "pt-BR")).toMatch(/,00$/);
  });

  it("renders negative amounts with the currency's minus styling", () => {
    expect(formatMoney(-500, "USD", "en")).toMatch(/500\.00/);
  });

  it.each([
    ["es", "locale", "."],
    ["es", "dot_decimal", ","],
    ["es", "comma_decimal", "."],
    ["en", "locale", ","],
    ["pt-BR", "locale", "."],
  ] as const)("always groups four-digit NIO amounts for %s with %s", (locale, pref, group) => {
    expect(formatMoney(3400, "NIO", locale, pref)).toContain(`3${group}400`);
  });

  it.each([
    ["es", "locale", "."],
    ["en", "locale", ","],
    ["pt-BR", "locale", "."],
  ] as const)("always groups four-digit money input values for %s", (locale, pref, group) => {
    expect(formatMoneyInput(3400, locale, pref)).toContain(`3${group}400`);
  });
});

describe("parseMoneyInput", () => {
  it("round-trips decimal amounts using the active locale", () => {
    const amount = 12.34;
    expect(parseMoneyInput(formatMoneyInput(amount, "es"), "es")).toBe(amount);
    expect(parseMoneyInput(formatMoneyInput(amount, "en"), "en")).toBe(amount);
  });

  it("parses comma-decimal es input (1.234,56)", () => {
    expect(parseMoneyInput("1.234,56", "es")).toBe(1234.56);
  });

  it("parses comma-decimal pt-BR input", () => {
    expect(parseMoneyInput("1.234,56", "pt-BR")).toBe(1234.56);
  });

  it("parses period-decimal en input (1,234.56)", () => {
    expect(parseMoneyInput("1,234.56", "en")).toBe(1234.56);
  });

  it("parses explicit preferences rather than guessing", () => {
    expect(parseMoneyInput("1.234", "es", "comma_decimal")).toBe(1234);
    expect(parseMoneyInput("1.234", "es", "dot_decimal")).toBe(1.234);
  });

  it.each(["Bs.", "R$", "C$"])('strips the "%s" symbol before parsing', (symbol) => {
    expect(parseMoneyInput(`${symbol}1.234,56`, "es", "comma_decimal")).toBe(1234.56);
  });

  it("tolerates currency symbols and the U+2212 minus sign", () => {
    expect(parseMoneyInput("$1.234,56", "es")).toBe(1234.56);
    expect(parseMoneyInput("−1.234,56", "es")).toBe(-1234.56);
    expect(parseMoneyInput("-1,234.56", "en")).toBe(-1234.56);
    expect(parseMoneyInput("−$1.234,56", "es")).toBe(-1234.56);
    expect(parseMoneyInput("-R$1,234.56", "en")).toBe(-1234.56);
  });

  it("treats a doubled minus sign as garbage, not a negative", () => {
    // Every U+2212 is normalized to "-" first; "−1−234,56" is then "-1-234.56",
    // which Number() rejects — so garbage in, null out.
    expect(parseMoneyInput("−1−234,56", "es")).toBeNull();
  });

  it("parses whole numbers without separators", () => {
    expect(parseMoneyInput("1234", "es")).toBe(1234);
    expect(parseMoneyInput("0", "en")).toBe(0);
  });

  it("treats a dot without a comma as grouping in es, not as a decimal", () => {
    // "5.25" in es means 5 followed by 25 → 525, NOT 5.25. Pinned so a future
    // change can't silently multiply es decimal entries by 1000.
    expect(parseMoneyInput("5.25", "es")).toBe(525);
  });

  it("collapses negative zero to 0", () => {
    expect(parseMoneyInput("-0", "es")).toBe(0);
  });

  it("returns null for empty or non-numeric input", () => {
    expect(parseMoneyInput("", "es")).toBeNull();
    expect(parseMoneyInput("abc", "es")).toBeNull();
    expect(parseMoneyInput(".", "en")).toBeNull();
    expect(parseMoneyInput("-", "es")).toBeNull();
  });
});

describe("maskMoneyInput", () => {
  it("strips non-numeric characters", () => {
    expect(maskMoneyInput("ab12cd34", "es", 2)).toBe("1234");
  });

  it("keeps one leading minus (U+2212 normalized to hyphen)", () => {
    expect(maskMoneyInput("−500", "es", 0)).toBe("-500");
    // en uses "," for grouping, "." for decimals — the mask keeps the leading
    // minus and the group separator verbatim for parseMoneyInput.
    expect(maskMoneyInput("-1,000", "en", 2)).toBe("-1,000");
  });

  it("keeps grouping separators (they survive to parseMoneyInput)", () => {
    expect(maskMoneyInput("12.345", "es", 0)).toBe("12.345");
    expect(maskMoneyInput("1,234", "en", 2)).toBe("1,234");
  });

  it("caps the fraction at minorUnit places (CLP accepts no decimals)", () => {
    expect(maskMoneyInput("12,345678", "es", 2)).toBe("12,34");
    expect(maskMoneyInput("12,345", "es", 0)).toBe("12345");
  });

  it("drops a trailing separator for minorUnit = 0", () => {
    expect(maskMoneyInput("123.", "es", 0)).toBe("123");
    expect(maskMoneyInput("123,", "es", 0)).toBe("123");
  });

  it("returns empty for non-numeric input", () => {
    expect(maskMoneyInput("", "es", 2)).toBe("");
    expect(maskMoneyInput("abc", "en", 2)).toBe("");
  });
});

describe("roundToMinorUnit", () => {
  it("rounds to the currency's minor unit", () => {
    expect(roundToMinorUnit(1234.567, 0)).toBe(1235);
    expect(roundToMinorUnit(1234.567, 2)).toBe(1234.57);
  });

  it("rounds half-cent values the way a human expects", () => {
    // 1.005*100 is 100.4999… in IEEE-754; must still round to 1.01.
    expect(roundToMinorUnit(1.005, 2)).toBe(1.01);
  });
});

describe("formatSignedMoney", () => {
  it("prepends the U+2212 minus sign for outflows", () => {
    expect(formatSignedMoney(-1234, "CLP", "es")).toContain("−");
    expect(formatSignedMoney(-1234, "CLP", "es").replace(/\D/g, "")).toBe("1234");
  });

  it("prepends + for inflows", () => {
    expect(formatSignedMoney(1234, "CLP", "es")).toContain("+");
    expect(formatSignedMoney(1234, "CLP", "es").replace(/\D/g, "")).toBe("1234");
  });
});
