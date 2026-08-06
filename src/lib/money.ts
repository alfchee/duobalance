export function formatMoney(amount: number, currency: string, locale = "es"): string {
  // Intl derives symbol, grouping, and decimal places from the currency code.
  // Do NOT pass minimumFractionDigits: 2 — CLP/PYG would be wrong.
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}

// Derive the locale's decimal/grouping separators. A 7-digit sample forces
// grouping to appear even in trimmed ICU builds (Node), where 4-digit samples
// may render without a group separator.
function separatorsFor(locale: string): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.89);
  const value = (type: "decimal" | "group") => parts.find((p) => p.type === type)?.value ?? "";
  const decimal = value("decimal") || ".";
  const group = value("group") || ",";
  return { decimal, group };
}

// Parse a user-typed amount in a locale's grouping/decimal convention:
// es/pt-BR "1.234,56" -> 1234.56, en "1,234.56" -> 1234.56. Currency
// symbols and the U+2212 minus sign are tolerated; non-numeric garbage
// yields null.
export function parseMoneyInput(raw: string, locale = "es"): number | null {
  const input = raw.replace(/[^\d.,−-]/g, "").replace("−", "-");
  if (!input) return null;

  const { decimal, group } = separatorsFor(locale);
  const normalized = input.split(group).join("").replace(decimal, ".");
  if (normalized === "-" || normalized === "." || normalized === "-.") return null;

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

export function roundToMinorUnit(amount: number, minorUnit: number): number {
  const f = 10 ** minorUnit;
  return Math.round(amount * f) / f;
}

export function formatSignedMoney(amount: number, currency: string, locale = "es"): string {
  if (amount < 0) {
    // U+2212 MINUS SIGN, not a hyphen — keeps alignment with Intl output
    return `−${formatMoney(Math.abs(amount), currency, locale)}`;
  }
  return `+${formatMoney(amount, currency, locale)}`;
}
