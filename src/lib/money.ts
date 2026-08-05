export function formatMoney(amount: number, currency: string, locale = "es"): string {
  // Intl derives symbol, grouping, and decimal places from the currency code.
  // Do NOT pass minimumFractionDigits: 2 — CLP/PYG would be wrong.
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}

export function parseMoneyInput(_raw: string, _locale = "es"): number | null {
  // Stub — see issue #16 for the comma-decimal / period-decimal implementation
  // and the unit tests covering CLP, USD, BRL.
  throw new Error("parseMoneyInput: stub (issue #16)");
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
