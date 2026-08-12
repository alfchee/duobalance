import type { ActivityFilters } from "@/lib/transactions/activity-filters";

export interface ActivityFilterOperations {
  accountIds(ids: readonly string[]): void;
  categoryIds(ids: readonly string[]): void;
  endDate(date: string): void;
  expense(): void;
  income(): void;
  memberId(id: string): void;
  search(term: string): void;
  startDate(date: string): void;
  transfer(): void;
}

export function activitySearchTerm(query: string): string {
  return query.trim().replace(/[(),]/g, " ");
}

export function applyActivityFilters(
  filters: ActivityFilters,
  operations: ActivityFilterOperations,
): void {
  if (filters.startDate) operations.startDate(filters.startDate);
  if (filters.endDate) operations.endDate(filters.endDate);
  if (filters.accountIds.length) operations.accountIds(filters.accountIds);
  if (filters.categoryIds.length) operations.categoryIds(filters.categoryIds);
  if (filters.memberId) operations.memberId(filters.memberId);
  if (filters.type === "expense") operations.expense();
  if (filters.type === "income") operations.income();
  if (filters.type === "transfer") operations.transfer();
  const search = activitySearchTerm(filters.query);
  if (search) operations.search(search);
}
