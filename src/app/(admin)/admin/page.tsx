"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { AdminGate } from "@/components/admin/admin-gate";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type AdminHousehold = {
  household_id: string;
  household_name: string;
  country: string | null;
  created_at: string;
  last_activity: string | null;
  plan_code: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
  is_comped: boolean | null;
  member_count: number;
  account_count: number;
  transaction_count: number;
};

const PAGE_SIZE = 50;

// One-screen status filters (#272): the plain lifecycle statuses match the
// live row; comped/none/expired are server-side special cases (see the
// route header + migration 20260930000002). "none" = no live subscription
// (expired + never-subscribed); "expired" narrows that to households with
// an expired subscription row behind them.
const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "trialing", label: "trialing" },
  { value: "active", label: "active" },
  { value: "past_due", label: "past_due" },
  { value: "grace", label: "grace" },
  { value: "cancelled", label: "cancelled" },
  { value: "expired", label: "expired" },
  { value: "comped", label: "comped" },
  { value: "none", label: "no subscription" },
] as const;

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

// Admin home (#271 scaffolding, #272 views): searchable household list
// showing plan, subscription status, member count, created date and last
// activity as COUNTS only. Search matches name, id, or member email
// (server-side; the address is never returned). Comped rows are visually
// distinct (amber wash + border + badge) so support cannot mistake them
// for paying households.
export default function AdminPage() {
  return (
    <AdminGate>
      <AdminHouseholdList />
    </AdminGate>
  );
}

function AdminHouseholdList() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<AdminHousehold[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [offset, setOffset] = useState(0);
  // Debounced search: every list fetch writes a `households.list` audit row
  // server-side, so typing "smith" must not issue 5 audited requests.
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (status) params.set("status", status);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    const suffix = `?${params.toString()}`;
    apiFetch<{ households: AdminHousehold[] }>(`/api/admin/households${suffix}`)
      .then((data) => {
        if (!cancelled) {
          setRows(data.households);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load households.");
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, status, offset, retryKey]);

  const hasMore = rows.length === PAGE_SIZE;

  return (
    <Card className="w-full">
      <CardHeader>
        <h1 className="text-2xl font-black tracking-tight">Admin — households</h1>
        <CardDescription>
          Billing state and aggregate counts only. Transaction contents are never shown here by
          design (see docs/admin-boundary.md).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="admin-search">Search by name, identifier, or member email</Label>
            <Input
              id="admin-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Household name, id, or owner email…"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-status">Status</Label>
            <select
              id="admin-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}{" "}
            <button type="button" className="underline" onClick={() => setRetryKey((k) => k + 1)}>
              Retry
            </button>
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No households match.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {rows.map((h) => {
                const comped = h.is_comped === true;
                return (
                  <li
                    key={h.household_id}
                    className={cn(
                      "flex flex-wrap items-center gap-2 rounded-lg border p-3",
                      comped && "border-amber-500/60 bg-amber-500/10",
                    )}
                  >
                    <Link href={`/admin/${h.household_id}`} className="font-semibold underline">
                      {h.household_name}
                    </Link>
                    {comped ? (
                      <Badge
                        variant="secondary"
                        className="border-amber-600/50 bg-amber-400/30 font-bold uppercase text-amber-900 dark:text-amber-200"
                      >
                        comped
                      </Badge>
                    ) : null}
                    <Badge variant="outline">{h.subscription_status ?? "no subscription"}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {h.plan_code ?? "—"} · {h.member_count} members · {h.account_count} accounts ·{" "}
                      {h.transaction_count} transactions
                    </span>
                    <span className="w-full text-xs text-muted-foreground">
                      Created {formatDate(h.created_at)} · Last activity{" "}
                      {formatDate(h.last_activity)}
                      {h.subscription_status === "grace" && h.grace_ends_at
                        ? ` · Grace ends ${formatDate(h.grace_ends_at)}`
                        : null}
                      {h.current_period_end
                        ? ` · Renews ${formatDate(h.current_period_end)}`
                        : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs text-muted-foreground">
                Showing {offset + 1}–{offset + rows.length} (page size {PAGE_SIZE})
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  className="rounded-md border border-input px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!hasMore}
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  className="rounded-md border border-input px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
