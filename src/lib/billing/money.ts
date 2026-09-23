import { z } from "zod";

// Billing Money (issue #258, ADR 0002).
//
// A payment amount is never a bare number: it always carries its currency,
// so a future adapter can never mistake minor units in one currency for
// another. `amount` is an integer in the currency's minor unit — see the
// `minor_unit` column on the `currencies` table (NIO = 0, USD = 2), so
// C$129 is `{ amount: 129, currency: "NIO" }` while $3.50 is
// `{ amount: 350, currency: "USD" }`.
//
// Display formatting stays in `src/lib/money.ts`, which takes major units:
// convert with `toMajorUnits()` first.
export const moneySchema = z
  .object({
    amount: z.number().int(),
    currency: z.string().regex(/^[A-Z]{3}$/, "ISO 4217 currency code (e.g. NIO, USD)"),
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
  return money.amount / 10 ** minorUnit;
}
