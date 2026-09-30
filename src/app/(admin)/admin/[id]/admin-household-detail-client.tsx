"use client";

import { useEffect, useMemo, useState } from "react";
import { notFound } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SubscriptionRow = {
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

type BillingEventRow = {
  id: string;
  provider: string;
  provider_event_id: string;
  subscription_id: string;
  type: string;
  received_at: string;
  processed_at: string | null;
};

type HouseholdSummary = {
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

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

type TimelineEntry =
  | { kind: "event"; at: string; event: BillingEventRow }
  | { kind: "subscription"; at: string; subscription: SubscriptionRow };

// Admin household detail (#271 scaffolding, #272 views): subscription
// history with every state transition plus billing-event metadata, joined
// into one timeline so "why did access change" reads top to bottom.
// Lifecycle rows mutate status in place (#260), so the transition log IS
// the billing_events ledger ordered by received_at; each subscription card
// groups its triggering events underneath (by subscription_id) and the
// timeline merges both sources chronologically. Counts only for ledger
// data; transaction contents never leave the server (the API allowlist
// drops them before responding, and the DEFINER functions cannot return
// them at all).
export function AdminHouseholdDetailClient({ id }: { id: string }) {
  const billingEnabled = useBillingEnabled();
  const [data, setData] = useState<{
    household: HouseholdSummary;
    subscriptions: SubscriptionRow[];
    billingEvents: BillingEventRow[];
  } | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!billingEnabled) {
      setDenied(true);
      return;
    }
    let cancelled = false;
    apiFetch<{
      household: HouseholdSummary;
      subscriptions: SubscriptionRow[];
      billingEvents: BillingEventRow[];
    }>(`/api/admin/households?id=${encodeURIComponent(id)}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });
    return () => {
      cancelled = true;
    };
  }, [billingEnabled, id]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!data) return [];
    const entries: TimelineEntry[] = [
      ...data.subscriptions.map((s): TimelineEntry => ({
        kind: "subscription",
        at: s.created_at,
        subscription: s,
      })),
      ...data.billingEvents.map((e): TimelineEntry => ({
        kind: "event",
        at: e.received_at,
        event: e,
      })),
    ];
    entries.sort((a, b) => +new Date(a.at) - +new Date(b.at));
    return entries;
  }, [data]);

  // Neutral denial, same as every other admin URL: notFound() preserves
  // the URL (unlike a redirect to a /not-found route, which does not exist)
  // and reveals nothing about whether the household exists.
  if (denied) {
    notFound();
  }
  if (!data) {
    return (
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        Loading household…
      </p>
    );
  }

  const comped = data.household.is_comped === true;
  const eventsBySubscription = new Map<string, BillingEventRow[]>();
  for (const e of data.billingEvents) {
    const list = eventsBySubscription.get(e.subscription_id) ?? [];
    list.push(e);
    eventsBySubscription.set(e.subscription_id, list);
  }

  return (
    <Card className={cn("w-full", comped && "border-amber-500/60")}>
      <CardHeader className={cn(comped && "rounded-t-xl bg-amber-500/10")}>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-black tracking-tight">
          {data.household.household_name}{" "}
          {comped ? (
            <Badge
              variant="secondary"
              className="border-amber-600/50 bg-amber-400/30 font-bold uppercase text-amber-900 dark:text-amber-200"
            >
              comped — founder plan, behaves differently from paying plans
            </Badge>
          ) : null}
        </h1>
        <CardDescription>
          {data.household.plan_code ?? "—"} ·{" "}
          {data.household.subscription_status ?? "no subscription"} · {data.household.member_count}{" "}
          members · {data.household.account_count} accounts · {data.household.transaction_count}{" "}
          transactions (counts only) · Created {formatDate(data.household.created_at)} · Last
          activity {formatDate(data.household.last_activity)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section aria-label="Subscription history">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">Subscription history</h2>
          {data.subscriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subscriptions. The household holds no plan row.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.subscriptions.map((s) => {
                const triggers = (eventsBySubscription.get(s.id) ?? []).sort(
                  (a, b) => +new Date(a.received_at) - +new Date(b.received_at),
                );
                return (
                  <li key={s.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-semibold">
                        {s.status}
                      </Badge>
                      <span className="font-semibold">{s.plan_code}</span>
                      <span className="text-muted-foreground">
                        · {s.provider} · created {formatDateTime(s.created_at)} · updated{" "}
                        {formatDateTime(s.updated_at)}
                      </span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                      <div>
                        <dt className="font-semibold">Trial ends</dt>
                        <dd>{formatDateTime(s.trial_ends_at)}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold">Period end / renews</dt>
                        <dd>{formatDateTime(s.current_period_end)}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold">Grace ends</dt>
                        <dd>{formatDateTime(s.grace_ends_at)}</dd>
                      </div>
                    </dl>
                    {triggers.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        No billing events for this subscription (provisioned directly, e.g. comped
                        backfill — no provider delivery).
                      </p>
                    ) : (
                      <div className="mt-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Triggering events ({triggers.length})
                        </p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {triggers.map((e) => (
                            <li key={e.id} className="rounded border bg-muted/40 px-2 py-1 text-xs">
                              <span className="font-semibold">{e.type}</span> · received{" "}
                              {formatDateTime(e.received_at)}
                              {e.processed_at
                                ? ` · processed ${formatDateTime(e.processed_at)}`
                                : " · unprocessed"}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-label="Billing timeline">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">
            Timeline — transitions with triggering events
          </h2>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No billing history.</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {timeline.map((entry, i) =>
                entry.kind === "event" ? (
                  <li key={`e-${entry.event.id}`} className="rounded border px-2 py-1.5 text-xs">
                    <span className="font-semibold">{entry.event.type}</span>{" "}
                    <span className="text-muted-foreground">
                      · {formatDateTime(entry.event.received_at)} · event{" "}
                      {entry.event.provider_event_id} → subscription{" "}
                      {entry.event.subscription_id.slice(0, 8)}…
                    </span>
                    <span className="sr-only">Timeline entry {i + 1}</span>
                  </li>
                ) : (
                  <li
                    key={`s-${entry.subscription.id}`}
                    className="rounded border border-dashed px-2 py-1.5 text-xs"
                  >
                    <span className="font-semibold">
                      subscription → {entry.subscription.status}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      · {entry.subscription.plan_code} ·{" "}
                      {formatDateTime(entry.subscription.created_at)}
                    </span>
                    <span className="sr-only">Timeline entry {i + 1}</span>
                  </li>
                ),
              )}
            </ol>
          )}
        </section>
        <section aria-label="Billing events">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">Billing events</h2>
          {data.billingEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No billing events.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.billingEvents.map((e) => (
                <li key={e.id} className="rounded-lg border p-3 text-sm">
                  <span className="font-semibold">{e.type}</span> · {formatDateTime(e.received_at)}
                  <span className="block text-xs text-muted-foreground">
                    provider {e.provider} · event {e.provider_event_id} · subscription{" "}
                    {e.subscription_id.slice(0, 8)}…
                    {e.processed_at ? ` · processed ${formatDateTime(e.processed_at)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
