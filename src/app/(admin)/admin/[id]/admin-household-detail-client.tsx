"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

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
  household_name: string;
  plan_code: string | null;
  subscription_status: string | null;
  is_comped: boolean | null;
  member_count: number;
  account_count: number;
  transaction_count: number;
};

// Admin household detail (#271 scaffolding): subscription history with every
// state transition plus billing-event metadata. Counts only for ledger data;
// transaction contents never leave the server (the API allowlist drops them
// before responding, and the DEFINER functions cannot return them at all).
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

  return (
    <Card className="w-full">
      <CardHeader>
        <h1 className="text-2xl font-black tracking-tight">
          {data.household.household_name}{" "}
          {data.household.is_comped ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 align-middle text-xs font-bold uppercase">
              comped
            </span>
          ) : null}
        </h1>
        <CardDescription>
          {data.household.plan_code ?? "—"} ·{" "}
          {data.household.subscription_status ?? "no subscription"} · {data.household.member_count}{" "}
          members · {data.household.account_count} accounts · {data.household.transaction_count}{" "}
          transactions (counts only)
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section aria-label="Subscription history">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide">Subscription history</h2>
          {data.subscriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No subscriptions.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.subscriptions.map((s) => (
                <li key={s.id} className="rounded-lg border p-3 text-sm">
                  <span className="font-semibold">{s.status}</span> · {s.plan_code} ·{" "}
                  {new Date(s.created_at).toLocaleDateString()}
                  {s.current_period_end
                    ? ` → ends ${new Date(s.current_period_end).toLocaleDateString()}`
                    : ""}
                </li>
              ))}
            </ul>
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
                  <span className="font-semibold">{e.type}</span> ·{" "}
                  {new Date(e.received_at).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
