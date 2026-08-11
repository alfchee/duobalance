export interface ActivityTransaction {
  readonly amount: number;
  readonly base_amount: number | null;
  readonly transfer_group_id: string | null;
}

export interface DatedActivityTransaction extends ActivityTransaction {
  readonly occurred_on: string;
}

export interface ActivitySummary {
  readonly count: number;
  readonly inflow: number;
  readonly outflow: number;
}

export interface ActivityDay<T extends DatedActivityTransaction> {
  readonly date: string;
  readonly subtotal: number;
  readonly transactions: readonly T[];
}

export function summarizeActivity(transactions: readonly ActivityTransaction[]): ActivitySummary {
  return transactions.reduce<ActivitySummary>(
    (totals, transaction) => {
      if (transaction.transfer_group_id) return { ...totals, count: totals.count + 1 };
      const amount = transaction.base_amount ?? 0;
      return {
        count: totals.count + 1,
        inflow: totals.inflow + (amount > 0 ? amount : 0),
        outflow: totals.outflow + (amount < 0 ? Math.abs(amount) : 0),
      };
    },
    { count: 0, inflow: 0, outflow: 0 },
  );
}

export function activityDaySubtotal(transactions: readonly ActivityTransaction[]): number {
  return transactions.reduce(
    (total, transaction) =>
      transaction.transfer_group_id ? total : total + (transaction.base_amount ?? 0),
    0,
  );
}

export function groupActivityByDay<T extends DatedActivityTransaction>(
  transactions: readonly T[],
): readonly ActivityDay<T>[] {
  const groups = new Map<string, T[]>();
  transactions.forEach((transaction) => {
    const group = groups.get(transaction.occurred_on);
    if (group) group.push(transaction);
    else groups.set(transaction.occurred_on, [transaction]);
  });
  return [...groups].map(([date, dayTransactions]) => ({
    date,
    subtotal: activityDaySubtotal(dayTransactions),
    transactions: dayTransactions,
  }));
}
