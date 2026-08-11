export const ACTIVITY_TRANSACTION_TYPES = ["all", "expense", "income", "transfer"] as const;

export type ActivityTransactionType = (typeof ACTIVITY_TRANSACTION_TYPES)[number];

export interface ActivityFilters {
  readonly accountIds: readonly string[];
  readonly categoryIds: readonly string[];
  readonly endDate: string | null;
  readonly memberId: string | null;
  readonly query: string;
  readonly startDate: string | null;
  readonly type: ActivityTransactionType;
}

export type ActivityFilterUpdates = Record<string, string | null>;

const FILTER_SEPARATOR = ",";

function idsFromSearch(value: string | null): string[] {
  return [...new Set(value?.split(FILTER_SEPARATOR).filter(Boolean) ?? [])];
}

function typeFromSearch(value: string | null): ActivityTransactionType {
  return (ACTIVITY_TRANSACTION_TYPES as readonly string[]).includes(value ?? "")
    ? (value as ActivityTransactionType)
    : "all";
}

export function readActivityFilters(
  searchParams: URLSearchParams,
  accountDetailId: string | null,
): ActivityFilters {
  return {
    accountIds: accountDetailId ? [accountDetailId] : idsFromSearch(searchParams.get("accounts")),
    categoryIds: idsFromSearch(searchParams.get("categories")),
    endDate: searchParams.get("end"),
    memberId: searchParams.get("member"),
    query: searchParams.get("q") ?? "",
    startDate: searchParams.get("start"),
    type: typeFromSearch(searchParams.get("type")),
  };
}

export function hasActivityFilters(filters: ActivityFilters): boolean {
  return Boolean(
    filters.query ||
    filters.startDate ||
    filters.endDate ||
    filters.accountIds.length ||
    filters.categoryIds.length ||
    filters.memberId ||
    filters.type !== "all",
  );
}

export function serializeActivityFilterIds(ids: readonly string[]): string | null {
  return ids.length ? ids.join(FILTER_SEPARATOR) : null;
}

export function clearActivityFilterUpdates(): ActivityFilterUpdates {
  return {
    accounts: null,
    accountDetail: null,
    categories: null,
    end: null,
    member: null,
    q: null,
    start: null,
    type: null,
  };
}

export function applyActivityFilterUpdates(
  current: URLSearchParams,
  updates: ActivityFilterUpdates,
): URLSearchParams {
  const next = new URLSearchParams(current);
  Object.entries(updates).forEach(([key, value]) => {
    if (value) next.set(key, value);
    else next.delete(key);
  });
  return next;
}

export function activityRoute(
  accountId: string | undefined,
  searchParams: URLSearchParams,
): string {
  const path = accountId ? `/accounts/${accountId}` : "/transactions";
  return searchParams.size ? `${path}?${searchParams.toString()}` : path;
}
