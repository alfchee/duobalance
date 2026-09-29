"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { AdminGate } from "@/components/admin/admin-gate";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AdminHousehold = {
  household_id: string;
  household_name: string;
  country: string | null;
  created_at: string;
  plan_code: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
  is_comped: boolean | null;
  member_count: number;
  account_count: number;
  transaction_count: number;
};

// Admin home (#271 scaffolding): searchable household list showing plan,
// status, member count, created date and last activity as COUNTS only.
// Full subscription-history detail, overrides and coupon screens land in
// #272–#274 on top of the /api/admin/households?id= endpoint shipped here.
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

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
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
  }, [search, status, retryKey]);

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
            <Label htmlFor="admin-search">Search by name or identifier</Label>
            <Input
              id="admin-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Household name or id…"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-status">Status</Label>
            <select
              id="admin-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All</option>
              <option value="trialing">trialing</option>
              <option value="active">active</option>
              <option value="past_due">past_due</option>
              <option value="grace">grace</option>
              <option value="cancelled">cancelled</option>
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
          <ul className="flex flex-col gap-2">
            {rows.map((h) => (
              <li
                key={h.household_id}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
              >
                <Link href={`/admin/${h.household_id}`} className="font-semibold underline">
                  {h.household_name}
                </Link>
                {h.is_comped ? <Badge variant="secondary">comped</Badge> : null}
                <Badge variant="outline">{h.subscription_status ?? "no subscription"}</Badge>
                <span className="text-sm text-muted-foreground">
                  {h.plan_code ?? "—"} · {h.member_count} members · {h.account_count} accounts ·{" "}
                  {h.transaction_count} transactions
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
