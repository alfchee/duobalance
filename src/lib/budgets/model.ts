export type BudgetScope = "household" | "mine";

export type BudgetSort = "name" | "remaining" | "spent";

export type BudgetStatusRecord = {
  amount: number | null;
  category_id: string | null;
  id: string | null;
  remaining: number | null;
  rollover: boolean | null;
  spent: number | null;
};

export type BudgetSpendingRecord = {
  base_amount: number | null;
  category_id: string | null;
  description: string;
};

export type BudgetCategory = {
  id: string;
  name: string;
};

export type BudgetRow = {
  amount: number;
  categoryId: string;
  id: string | null;
  merchants: string[];
  name: string;
  remaining: number;
  rollover: boolean;
  spent: number;
};

export type CopyBudgetDraft = {
  amount: number;
  categoryId: string;
  name: string;
  rollover: boolean;
};

export type BudgetSummary = {
  spent: number;
  totalBudget: number;
};

export type CopyBudgetInput = {
  amount: number;
  category_id: string;
  owner_member_id: string | null;
  period_month: string;
  rollover: boolean;
};

export function moveBudgetMonth(periodMonth: string, offset: number): string {
  const date = new Date(`${periodMonth}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}

export function getBudgetMonthEnd(periodMonth: string): string {
  const nextMonth = new Date(`${periodMonth}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  nextMonth.setUTCDate(0);
  return nextMonth.toISOString().slice(0, 10);
}

export function getBudgetMonthLabel(periodMonth: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${periodMonth}T00:00:00Z`));
}

function getCategoryName(
  categories: readonly BudgetCategory[],
  categoryId: string,
  unknownCategory: string,
) {
  return categories.find((category) => category.id === categoryId)?.name ?? unknownCategory;
}

function addMerchant(merchants: string[], description: string): string[] {
  const merchant = description.trim();
  if (!merchant || merchants.includes(merchant) || merchants.length >= 2) return merchants;
  return [...merchants, merchant];
}

export function createBudgetRows({
  budgetStatus,
  categories,
  sort,
  spending,
  unknownCategory,
}: {
  budgetStatus: readonly BudgetStatusRecord[];
  categories: readonly BudgetCategory[];
  sort: BudgetSort;
  spending: readonly BudgetSpendingRecord[];
  unknownCategory: string;
}): BudgetRow[] {
  const rowsByCategory = new Map<string, BudgetRow>();
  for (const budget of budgetStatus) {
    if (!budget.category_id) continue;
    rowsByCategory.set(budget.category_id, {
      amount: budget.amount ?? 0,
      categoryId: budget.category_id,
      id: budget.id,
      merchants: [],
      name: getCategoryName(categories, budget.category_id, unknownCategory),
      remaining: budget.remaining ?? 0,
      rollover: budget.rollover ?? false,
      spent: budget.spent ?? 0,
    });
  }
  for (const transaction of spending) {
    if (!transaction.category_id) continue;
    // base_amount is a generated column (amount * fx_rate) and fx_rate is
    // NOT NULL on every write path (form validation, create_transfer RPC), so
    // this can't actually be null for a real row — the fallback is here only
    // because the generated column type is conservatively nullable.
    const spent = Math.abs(transaction.base_amount ?? 0);
    const current = rowsByCategory.get(transaction.category_id);
    if (current?.id === null) {
      rowsByCategory.set(transaction.category_id, {
        ...current,
        merchants: addMerchant(current.merchants, transaction.description),
        remaining: current.remaining - spent,
        spent: current.spent + spent,
      });
      continue;
    }
    if (current) {
      rowsByCategory.set(transaction.category_id, {
        ...current,
        merchants: addMerchant(current.merchants, transaction.description),
      });
      continue;
    }
    rowsByCategory.set(transaction.category_id, {
      amount: 0,
      categoryId: transaction.category_id,
      id: null,
      merchants: addMerchant([], transaction.description),
      name: getCategoryName(categories, transaction.category_id, unknownCategory),
      remaining: -spent,
      rollover: false,
      spent,
    });
  }
  return [...rowsByCategory.values()].sort((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name);
    if (sort === "remaining") return left.remaining - right.remaining || right.spent - left.spent;
    return right.spent - left.spent || left.name.localeCompare(right.name);
  });
}

export function createCopyBudgetDrafts(
  budgetStatus: readonly BudgetStatusRecord[],
  categories: readonly BudgetCategory[],
  unknownCategory: string,
): CopyBudgetDraft[] {
  return budgetStatus.flatMap((budget) => {
    if (!budget.category_id || budget.amount === null) return [];
    return {
      amount: budget.amount,
      categoryId: budget.category_id,
      name: getCategoryName(categories, budget.category_id, unknownCategory),
      rollover: budget.rollover ?? false,
    };
  });
}

export function calculateBudgetSummary(rows: readonly BudgetRow[]): BudgetSummary {
  return rows.reduce<BudgetSummary>(
    (summary, row) => ({
      spent: summary.spent + row.spent,
      totalBudget: summary.totalBudget + Math.max(row.amount, 0),
    }),
    { spent: 0, totalBudget: 0 },
  );
}

export function getBudgetProgress(row: Pick<BudgetRow, "amount" | "remaining" | "spent">) {
  const overBudget = row.remaining < 0 || (row.amount === 0 && row.spent > 0);
  const progress =
    row.amount > 0 ? Math.min((row.spent / row.amount) * 100, 100) : row.spent > 0 ? 100 : 0;
  const percentUsed =
    row.amount > 0 ? Math.min(Math.round((row.spent / row.amount) * 100), 100) : 0;
  return { overBudget, percentUsed, progress };
}

export function buildBudgetTransactionsHref(categoryId: string, periodMonth: string): string {
  return `/transactions?categories=${categoryId}&start=${periodMonth}&end=${getBudgetMonthEnd(periodMonth)}&type=expense`;
}

export function adjustCopyBudgetDrafts(
  drafts: readonly CopyBudgetDraft[],
  percentage: number,
  roundAmount: (amount: number) => number,
): CopyBudgetDraft[] {
  if (!Number.isFinite(percentage)) return [...drafts];
  return drafts.map((draft) => ({
    ...draft,
    amount: roundAmount(draft.amount * (1 + percentage / 100)),
  }));
}

export function replaceCopyBudgetDraftAmount(
  drafts: readonly CopyBudgetDraft[],
  categoryId: string,
  amount: number,
): CopyBudgetDraft[] {
  return drafts.map((draft) => (draft.categoryId === categoryId ? { ...draft, amount } : draft));
}

export function createCopyBudgetInputs(
  drafts: readonly CopyBudgetDraft[],
  ownerMemberId: string | null,
  periodMonth: string,
): CopyBudgetInput[] {
  return drafts.map((draft) => ({
    amount: draft.amount,
    category_id: draft.categoryId,
    owner_member_id: ownerMemberId,
    period_month: periodMonth,
    rollover: draft.rollover,
  }));
}
