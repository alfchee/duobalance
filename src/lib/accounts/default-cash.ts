export function getDefaultCashName(locale: string | null | undefined): string {
  if (locale === "es") return "Efectivo";
  if (locale === "pt-BR") return "Dinheiro";
  return "Cash";
}

// Shared in-memory lock to deduplicate concurrent Cash creation across
// multiple callers (BalancesView hook + transaction sheet) within the same
// tab. The DB no longer has a unique(household_id,name) constraint, so
// without this two parallel inserts would leave duplicate Cash rows.
const creatingHouseholds = new Set<string>();

export function isCreatingDefaultCash(householdId: string): boolean {
  return creatingHouseholds.has(householdId);
}

export function markCreatingDefaultCash(householdId: string): void {
  creatingHouseholds.add(householdId);
}

export function clearCreatingDefaultCash(householdId: string): void {
  creatingHouseholds.delete(householdId);
}
