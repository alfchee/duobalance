export type NumberFormatPref = "locale" | "dot_decimal" | "comma_decimal";

const NUMBER_FORMAT_PREFS: readonly NumberFormatPref[] = ["locale", "dot_decimal", "comma_decimal"];

export function isNumberFormatPref(value: string): value is NumberFormatPref {
  return (NUMBER_FORMAT_PREFS as readonly string[]).includes(value);
}

type Separators = { decimal: string; group: string };

export function formatMoney(
  amount: number,
  currency: string,
  locale = "es",
  pref: NumberFormatPref = "locale",
): string {
  const parts = new Intl.NumberFormat(locale, {
    currency,
    style: "currency",
    useGrouping: true,
  }).formatToParts(amount);
  if (pref === "locale") return parts.map((part) => part.value).join("");

  const { decimal, group } = separatorsFor(locale, pref);
  return parts
    .map((part) => {
      if (part.type === "decimal") return decimal;
      if (part.type === "group") return group;
      return part.value;
    })
    .join("");
}

export function formatMoneyInput(
  amount: number,
  locale = "es",
  pref: NumberFormatPref = "locale",
): string {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(amount);
  if (pref === "locale") return parts.map((part) => part.value).join("");

  const { decimal, group } = separatorsFor(locale, pref);
  return parts
    .map((part) => {
      if (part.type === "decimal") return decimal;
      if (part.type === "group") return group;
      return part.value;
    })
    .join("");
}

// Derive the locale's decimal/grouping separators, unless pref is
// "dot_decimal"/"comma_decimal", which fixes the separators regardless of
// locale. A 7-digit sample forces grouping to appear even in trimmed ICU
// builds (Node), where 4-digit samples may render without a group separator.
// Cached — keypads call this per keystroke.
const separatorCache = new Map<string, Separators>();
function separatorsFor(locale: string, pref: NumberFormatPref = "locale"): Separators {
  if (pref === "dot_decimal") return { decimal: ".", group: "," };
  if (pref === "comma_decimal") return { decimal: ",", group: "." };

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
// es/pt-BR "1.234,56" -> 1234.56, en "1,234.56" -> 1234.56. When pref is
// "dot_decimal"/"comma_decimal", the fixed separators are used instead of the
// locale's, overriding locale entirely. Currency symbols and the U+2212 minus
// sign are tolerated; non-numeric garbage yields null.
//
// LENIENT by design: grouping separators are stripped wherever they appear,
// so "5.25" in es parses as 525 and "1..2..3" collapses instead of failing.
// This pairs with maskMoneyInput, which keeps grouping separators verbatim
// for this parser. For submit paths that must reject malformed grouping
// ("1..2..3", "1.2.3"), use parseMoneyInputStrict instead.
export function parseMoneyInput(
  raw: string,
  locale = "es",
  pref: NumberFormatPref = "locale",
): number | null {
  return parseMoneyInputInternal(raw, locale, pref, false);
}

// Strict sibling: additionally requires the integer part to match the
// locale's grouping pattern (1-3 digits, then groups of exactly 3), so
// typos like "1..2..3" or "1.2.3" yield null instead of a 100x value.
// Use on submit when the field is not pre-sanitized by maskMoneyInput.
export function parseMoneyInputStrict(
  raw: string,
  locale = "es",
  pref: NumberFormatPref = "locale",
): number | null {
  return parseMoneyInputInternal(raw, locale, pref, true);
}

function parseMoneyInputInternal(
  raw: string,
  locale: string,
  pref: NumberFormatPref,
  strict: boolean,
): number | null {
  const firstDigit = raw.search(/\d/);
  if (firstDigit === -1) return null;
  const prefix = raw.slice(0, firstDigit);
  const signs = prefix.match(/[−-]/g) ?? [];
  if (signs.length > 1) return null;
  const lastDigit = raw.lastIndexOf(raw.match(/\d(?!.*\d)/)?.[0] ?? "");
  const input = `${signs.length === 1 ? "-" : ""}${raw
    .slice(firstDigit, lastDigit + 1)
    .replace(/−/g, "-")}`;
  if (!/^-?[\d.,]+$/.test(input)) return null;

  const { decimal, group } = separatorsFor(locale, pref);
  const decimalParts = input.split(decimal);
  if (decimalParts.length > 2) return null;
  const integer = decimalParts[0] ?? "";
  const fraction = decimalParts[1];
  const sign = integer.startsWith("-") ? "-" : "";
  const unsignedInteger = sign ? integer.slice(1) : integer;
  const groupPattern = new RegExp(`^\\d{1,3}(?:${escapeRegExp(group)}\\d{3})*$|^\\d+$`);
  if (
    ((strict || pref !== "locale") && !groupPattern.test(unsignedInteger)) ||
    (fraction !== undefined && !/^\d+$/.test(fraction))
  ) {
    return null;
  }

  const normalized = `${sign}${unsignedInteger.split(group).join("")}${
    fraction === undefined ? "" : `.${fraction}`
  }`;
  if (normalized === "-" || normalized === "." || normalized === "-.") return null;

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return amount === 0 ? 0 : amount; // collapse -0, which Object.is treats as distinct
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Live mask for an amount input, enforced per keystroke: only digits, one
// leading minus, and the decimal/group separators (locale-derived, or fixed
// by pref when set) survive, and the fraction never exceeds minorUnit places
// (CLP accepts no decimals). The value is still a string — parse with
// parseMoneyInput on submit.
export function maskMoneyInput(
  raw: string,
  locale: string,
  minorUnit: number,
  pref: NumberFormatPref = "locale",
): string {
  const { decimal, group } = separatorsFor(locale, pref);
  const filtered = raw
    .replace(new RegExp(`[^0-9${escapeRegExp(decimal)}${escapeRegExp(group)}−-]`, "g"), "")
    .replace(/−/g, "-");

  const hasMinus = filtered.startsWith("-");
  let unsigned = (hasMinus ? filtered.slice(1) : filtered).replace(/-/g, "");

  // No fraction for whole-unit currencies: truncate at the first decimal
  // separator instead of joining — joining would silently inflate a typed
  // fraction ("12.34" -> "1234", 100x) before roundToMinorUnit persists it.
  if (minorUnit === 0) {
    const intOnly = unsigned.split(decimal)[0] ?? "";
    unsigned = intOnly.replace(new RegExp(`${escapeRegExp(group)}$`), "");
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

export function appendMoneyPadInput(
  value: string,
  key: string,
  locale: string,
  minorUnit: number,
  pref: NumberFormatPref = "locale",
): string {
  const { decimal } = separatorsFor(locale, pref);
  if (key === "backspace") return value.slice(0, -1);
  if (key === "." || key === ",") {
    return maskMoneyInput(`${value}${decimal}`, locale, minorUnit, pref);
  }
  return maskMoneyInput(`${value}${key}`, locale, minorUnit, pref);
}

export function roundToMinorUnit(amount: number, minorUnit: number): number {
  const f = 10 ** minorUnit;
  // Number.EPSILON nudges binary float error (1.005 * 100 = 100.49999…)
  // so half-cent values round the way a human expects. The nudge follows
  // the sign — a fixed +EPSILON would push negative halves toward zero
  // (-1.005 -> -1 instead of -1.01), biasing refunds/credits.
  return Math.round((amount + Math.sign(amount) * Number.EPSILON) * f) / f;
}

export function formatSignedMoney(
  amount: number,
  currency: string,
  locale = "es",
  pref: NumberFormatPref = "locale",
): string {
  if (amount < 0) {
    // U+2212 MINUS SIGN, not a hyphen — keeps alignment with Intl output
    return `−${formatMoney(Math.abs(amount), currency, locale, pref)}`;
  }
  return `+${formatMoney(amount, currency, locale, pref)}`;
}
