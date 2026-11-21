// Pure timeline helpers for the admin household detail screen (extracted
// from admin-household-detail-client.tsx). No hooks, no I/O — the component
// memoizes these over the fetched detail state.

export type SubscriptionRow = {
  id: string;
  plan_code: string;
  provider: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BillingEventRow = {
  id: string;
  provider: string;
  provider_event_id: string;
  subscription_id: string;
  type: string;
  received_at: string;
  processed_at: string | null;
};

export type HouseholdSummary = {
  household_id?: string;
  household_name: string;
  country?: string | null;
  created_at?: string;
  last_activity: string | null;
  plan_code: string | null;
  subscription_status: string | null;
  current_period_end?: string | null;
  grace_ends_at?: string | null;
  is_comped: boolean | null;
  member_count: number;
  account_count: number;
  transaction_count: number;
};

export type TimelineEntry =
  | { kind: "event"; at: string; event: BillingEventRow }
  | { kind: "subscription"; at: string; subscription: SubscriptionRow };

/** Merge subscriptions + billing events into one chronological timeline. */
export function buildAdminTimeline(
  subscriptions: SubscriptionRow[],
  billingEvents: BillingEventRow[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...subscriptions.map((s): TimelineEntry => ({
      kind: "subscription",
      at: s.created_at,
      subscription: s,
    })),
    ...billingEvents.map((e): TimelineEntry => ({
      kind: "event",
      at: e.received_at,
      event: e,
    })),
  ];
  entries.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  return entries;
}

/** Group billing events by subscription for the per-card trigger lists. */
export function groupEventsBySubscription(
  billingEvents: BillingEventRow[],
): Map<string, BillingEventRow[]> {
  const map = new Map<string, BillingEventRow[]>();
  for (const e of billingEvents) {
    const list = map.get(e.subscription_id) ?? [];
    list.push(e);
    map.set(e.subscription_id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => +new Date(a.received_at) - +new Date(b.received_at));
  }
  return map;
}
