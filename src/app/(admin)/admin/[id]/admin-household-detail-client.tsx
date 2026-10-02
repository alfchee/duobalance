"use client";

import { useEffect, useMemo, useState } from "react";
import { notFound } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import { formatDate, formatDateTime } from "@/components/admin/format";
import { AdminOverridePanel } from "./admin-override-panel";
import {
  buildAdminTimeline,
  groupEventsBySubscription,
  type BillingEventRow,
  type HouseholdSummary,
  type SubscriptionRow,
} from "./admin-timeline";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

  const timeline = useMemo(
    () => (data ? buildAdminTimeline(data.subscriptions, data.billingEvents) : []),
    [data],
  );

  const eventsBySubscription = useMemo(
    () =>
      data ? groupEventsBySubscription(data.billingEvents) : new Map<string, BillingEventRow[]>(),
    [data],
  );

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
                // Pre-sorted in the eventsBySubscription memo above.
                const triggers = eventsBySubscription.get(s.id) ?? [];
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
        <AdminOverridePanel
          householdId={id}
          livePlan={data.household.plan_code}
          liveStatus={data.household.subscription_status}
          onApplied={(res) =>
            setData({
              household: res.household,
              subscriptions: res.subscriptions,
              billingEvents: res.billingEvents,
            })
          }
        />
      </CardContent>
    </Card>
  );
}

// (AdminOverridePanel + OVERRIDE_ACTION_META live in admin-override-panel.tsx;
// timeline grouping in admin-timeline.ts.)
