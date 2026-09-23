import { z } from "zod";

// Billing Money (issue #258, ADR 0002).
//
// A payment amount is never a bare number: it always carries its currency,
// so a future adapter can never mistake minor units in one currency for
// another. `amount` is an integer in the currency's minor unit — see the
// `minor_unit` column on the `currencies` table (NIO = 2, USD = 2; only
// CLP and PYG are 0 per the pgTAP contract in 01_reference_tables.sql), so
// C$129 is `{ amount: 12900, currency: "NIO" }` while $3.50 is
// `{ amount: 350, currency: "USD" }`. Negative amounts are permitted:
// credits and refunds reuse this same type rather than growing a second one.
//
// Display formatting stays in `src/lib/money.ts`, which takes major units:
// convert with `toMajorUnits()` first.

// Canonical active ISO 4217 codes, generated from
// `Intl.supportedValuesOf("currency")` (Node 22, full-icu). Syntax alone
// (`/^[A-Z]{3}$/`) would accept non-codes like "ABC" at the provider
// boundary, so membership here is the actual contract.
const ISO_4217_CODES: ReadonlySet<string> = new Set([
  "AED",
  "AFN",
  "ALL",
  "AMD",
  "ANG",
  "AOA",
  "ARS",
  "AUD",
  "AWG",
  "AZN",
  "BAM",
  "BBD",
  "BDT",
  "BGN",
  "BHD",
  "BIF",
  "BMD",
  "BND",
  "BOB",
  "BRL",
  "BSD",
  "BTN",
  "BWP",
  "BYN",
  "BZD",
  "CAD",
  "CDF",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CRC",
  "CUC",
  "CUP",
  "CVE",
  "CZK",
  "DJF",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ERN",
  "ETB",
  "EUR",
  "FJD",
  "FKP",
  "GBP",
  "GEL",
  "GHS",
  "GIP",
  "GMD",
  "GNF",
  "GTQ",
  "GYD",
  "HKD",
  "HNL",
  "HRK",
  "HTG",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "IQD",
  "IRR",
  "ISK",
  "JMD",
  "JOD",
  "JPY",
  "KES",
  "KGS",
  "KHR",
  "KMF",
  "KPW",
  "KRW",
  "KWD",
  "KYD",
  "KZT",
  "LAK",
  "LBP",
  "LKR",
  "LRD",
  "LSL",
  "LYD",
  "MAD",
  "MDL",
  "MGA",
  "MKD",
  "MMK",
  "MNT",
  "MOP",
  "MRU",
  "MUR",
  "MVR",
  "MWK",
  "MXN",
  "MYR",
  "MZN",
  "NAD",
  "NGN",
  "NIO",
  "NOK",
  "NPR",
  "NZD",
  "OMR",
  "PAB",
  "PEN",
  "PGK",
  "PHP",
  "PKR",
  "PLN",
  "PYG",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "RWF",
  "SAR",
  "SBD",
  "SCR",
  "SDG",
  "SEK",
  "SGD",
  "SHP",
  "SLE",
  "SLL",
  "SOS",
  "SRD",
  "SSP",
  "STN",
  "SVC",
  "SYP",
  "SZL",
  "THB",
  "TJS",
  "TMT",
  "TND",
  "TOP",
  "TRY",
  "TTD",
  "TWD",
  "TZS",
  "UAH",
  "UGX",
  "USD",
  "UYU",
  "UZS",
  "VES",
  "VND",
  "VUV",
  "WST",
  "XAF",
  "XCD",
  "XCG",
  "XDR",
  "XOF",
  "XPF",
  "XSU",
  "YER",
  "ZAR",
  "ZMW",
  "ZWG",
  "ZWL",
]);

export const moneySchema = z
  .object({
    amount: z.number().int(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "ISO 4217 currency code (e.g. NIO, USD)")
      .refine((code) => ISO_4217_CODES.has(code), "Unknown ISO 4217 currency code"),
  })
  // Strict: a provider-shaped extra field ("just in case") is rejected
  // rather than silently stripped — see the #258 Notes.
  .strict();

export type Money = z.infer<typeof moneySchema>;

export function isMoney(value: unknown): value is Money {
  return moneySchema.safeParse(value).success;
}

export function createMoney(amount: number, currency: string): Money {
  return moneySchema.parse({ amount, currency });
}

/** Convert minor-unit storage to major units for display/parsers. */
export function toMajorUnits(money: Money, minorUnit: number): number {
  if (!Number.isInteger(minorUnit) || minorUnit < 0) {
    throw new RangeError(`minorUnit must be a non-negative integer (got ${minorUnit})`);
  }
  return money.amount / 10 ** minorUnit;
}
