import { describe, expect, it } from "vitest";
import { formatMoney, formatSignedMoney, parseMoneyInput, roundToMinorUnit } from "./money";

// The AC is about decimal count and separator, not grouping or symbol —
// the CLP symbol renders "$" in browsers/full-icu and "CLP" in a trimmed
// build, so assertions avoid the symbol and grouping entirely.
describe("formatMoney", () => {
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
});

describe("parseMoneyInput", () => {
  it("parses comma-decimal es input (1.234,56)", () => {
    expect(parseMoneyInput("1.234,56", "es")).toBe(1234.56);
  });

  it("parses comma-decimal pt-BR input", () => {
    expect(parseMoneyInput("1.234,56", "pt-BR")).toBe(1234.56);
  });

  it("parses period-decimal en input (1,234.56)", () => {
    expect(parseMoneyInput("1,234.56", "en")).toBe(1234.56);
  });

  it("tolerates currency symbols and the U+2212 minus sign", () => {
    expect(parseMoneyInput("$1.234,56", "es")).toBe(1234.56);
    expect(parseMoneyInput("−1.234,56", "es")).toBe(-1234.56);
    expect(parseMoneyInput("-1,234.56", "en")).toBe(-1234.56);
  });

  it("parses whole numbers without separators", () => {
    expect(parseMoneyInput("1234", "es")).toBe(1234);
    expect(parseMoneyInput("0", "en")).toBe(0);
  });

  it("returns null for empty or non-numeric input", () => {
    expect(parseMoneyInput("", "es")).toBeNull();
    expect(parseMoneyInput("abc", "es")).toBeNull();
    expect(parseMoneyInput(".", "en")).toBeNull();
    expect(parseMoneyInput("-", "es")).toBeNull();
  });
});

describe("roundToMinorUnit", () => {
  it("rounds to the currency's minor unit", () => {
    expect(roundToMinorUnit(1234.567, 0)).toBe(1235);
    expect(roundToMinorUnit(1234.567, 2)).toBe(1234.57);
  });
});

describe("formatSignedMoney", () => {
  it("prepends the U+2212 minus sign for outflows", () => {
    expect(formatSignedMoney(-1234, "CLP", "es")).toContain("−");
    expect(formatSignedMoney(-1234, "CLP", "es")).toContain("1234");
  });

  it("prepends + for inflows", () => {
    expect(formatSignedMoney(1234, "CLP", "es")).toContain("+");
    expect(formatSignedMoney(1234, "CLP", "es")).toContain("1234");
  });
});
