import type { Database } from "@/lib/supabase/types";

export type Account = Database["public"]["Tables"]["accounts"]["Row"];

export const ACCOUNT_KINDS = [
  "cash",
  "checking",
  "savings",
  "credit_card",
  "loan",
  "investment",
] as const;

export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export function isAccountKind(value: string): value is AccountKind {
  return (ACCOUNT_KINDS as readonly string[]).includes(value);
}

// credit_card and loan render as debt (the issue's negative-rendering rule).
export function isDebtKind(kind: string): boolean {
  return kind === "credit_card" || kind === "loan";
}

// The balance an account reports: manual accounts use the typed-in value;
// ledger accounts derive from opening_balance + sum(transactions) once #26
// lands — until transactions exist, opening_balance is the balance.
export function accountBalance(account: Account): number {
  if (account.balance_mode === "manual") return account.manual_balance ?? 0;
  return account.opening_balance;
}

// Debt kinds render their balance as an obligation: a stored positive owed
// amount shows negative, a stored negative stays negative.
export function displayBalance(account: Account): number {
  const balance = accountBalance(account);
  return isDebtKind(account.kind) ? -Math.abs(balance) : balance;
}

export function nextDisplayOrder(accounts: Account[]): number {
  return (
    accounts.reduce((max, a) => Math.max(max, a.display_order ?? 0), 0) +
    (accounts.length > 0 ? 1 : 0)
  );
}

// A private account must keep an owner (check accounts_private_needs_owner in
// migration #19). The form forces this itself; this matcher turns the raw
// constraint violation into a friendly message if the constraint is ever hit.
export function isPrivateNeedsOwnerError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  return err?.code === "23514" && (err?.message ?? "").includes("accounts_private_needs_owner");
}

// New relative order for the visible (non-archived) accounts. The visible list
// takes over the active slots in its new order; any active account absent from
// it (a partial reorder) falls back to its original relative position. Archived
// accounts keep their slots; the result gets fresh 0..n display_order values.
export function reorderAccounts(all: Account[], visible: Account[]): Account[] {
  const actives = all.filter((a) => !a.is_archived);
  const visibleIds = new Set(visible.map((a) => a.id));
  const leftovers = actives.filter((a) => !visibleIds.has(a.id));
  const newActives = [...visible, ...leftovers];
  let ai = 0;
  const ordered = all.map((account) => {
    if (account.is_archived) return account;
    return newActives[ai++] ?? account;
  });
  return ordered.map((account, i) => ({ ...account, display_order: i }));
}
