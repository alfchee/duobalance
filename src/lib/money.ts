export function formatMoney(amount: number, currency: string, locale = "es"): string {
  // Intl derives symbol, grouping, and decimal places from the currency code.
  // Do NOT pass minimumFractionDigits: 2 — CLP/PYG would be wrong.
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}

// Derive the locale's decimal/grouping separators. A 7-digit sample forces
// grouping to appear even in trimmed ICU builds (Node), where 4-digit samples
// may render without a group separator. Cached — keypads call this per keystroke.
const separatorCache = new Map<string, { decimal: string; group: string }>();
function separatorsFor(locale: string): { decimal: string; group: string } {
  const cached = separatorCache.get(locale);
  if (cached) return cached;
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.89);
  const value = (type: "decimal" | "group") => parts.find((p) => p.type === type)?.value ?? "";
  const separators = {
    decimal: value("decimal") || ".",
    group: value("group") || ",",
  };
  separatorCache.set(locale, separators);
  return separators;
}

// Parse a user-typed amount in a locale's grouping/decimal convention:
// es/pt-BR "1.234,56" -> 1234.56, en "1,234.56" -> 1234.56. Currency
// symbols and the U+2212 minus sign are tolerated; non-numeric garbage
// yields null.
export function parseMoneyInput(raw: string, locale = "es"): number | null {
  // Global replace: every U+2212 becomes an ASCII hyphen, so no U+2212 can
  // survive into `normalized` and trip Number() later.
  const input = raw.replace(/[^\d.,−-]/g, "").replace(/−/g, "-");
  if (!input) return null;

  const { decimal, group } = separatorsFor(locale);
  const normalized = input.split(group).join("").replace(decimal, ".");
  if (normalized === "-" || normalized === "." || normalized === "-.") return null;

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return amount === 0 ? 0 : amount; // collapse -0, which Object.is treats as distinct
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Live mask for an amount input, enforced per keystroke: only digits, one
// leading minus, and the locale's decimal/group separators survive, and the
// fraction never exceeds minorUnit places (CLP accepts no decimals). The
// value is still a string — parse with parseMoneyInput on submit.
export function maskMoneyInput(raw: string, locale: string, minorUnit: number): string {
  const { decimal, group } = separatorsFor(locale);
  const filtered = raw
    .replace(new RegExp(`[^0-9${escapeRegExp(decimal)}${escapeRegExp(group)}−-]`, "g"), "")
    .replace(/−/g, "-");

  const hasMinus = filtered.startsWith("-");
  let unsigned = (hasMinus ? filtered.slice(1) : filtered).replace(/-/g, "");

  // No fraction for whole-unit currencies: the decimal separator would read as
  // a decimal to parseMoneyInput (es "12,345" -> 12.345), so treat it as a
  // group separator and drop it.
  if (minorUnit === 0) {
    unsigned = unsigned
      .split(decimal)
      .join("")
      .replace(new RegExp(`${escapeRegExp(group)}$`), "");
    return (hasMinus ? "-" : "") + unsigned;
  }

  // Only the first decimal separator survives; anything after it is a fraction.
  const [intPart, ...fractionParts] = unsigned.split(decimal);
  let out = (hasMinus ? "-" : "") + intPart;
  if (fractionParts.length > 0) {
    const fraction = fractionParts.join("").slice(0, minorUnit);
    out += `${decimal}${fraction}`;
  }
  return out;
}

export function roundToMinorUnit(amount: number, minorUnit: number): number {
  const f = 10 ** minorUnit;
  // Number.EPSILON nudges binary float error (1.005 * 100 = 100.49999…)
  // so half-cent values round the way a human expects.
  return Math.round((amount + Number.EPSILON) * f) / f;
}

export function formatSignedMoney(amount: number, currency: string, locale = "es"): string {
  if (amount < 0) {
    // U+2212 MINUS SIGN, not a hyphen — keeps alignment with Intl output
    return `−${formatMoney(Math.abs(amount), currency, locale)}`;
  }
  return `+${formatMoney(amount, currency, locale)}`;
}
