"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { formatMoney } from "@/lib/money";
import { AdminGate } from "@/components/admin/admin-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type AdminCoupon = {
  code: string;
  discount_type: string;
  discount_value: number;
  currency: string | null;
  minor_unit: number | null;
  valid_from: string;
  valid_until: string;
  max_redemptions: number;
  per_household_limit: number;
  duration: string;
  active: boolean;
  created_at: string;
  updated_at: string | null;
  redemption_count: number;
  remaining_capacity: number;
};

type CouponRedemption = {
  coupon_code: string;
  household_id: string;
  redeemed_at: string;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function discountLabel(c: AdminCoupon): string {
  if (c.discount_type === "percent") return `${c.discount_value}%`;
  // Amounts are stored in minor units — scale by the currency's own
  // minor_unit (never a guessed decimal count) before formatting.
  if (!c.currency) return `${c.discount_value} (minor units)`;
  return formatMoney(c.discount_value / 10 ** (c.minor_unit ?? 2), c.currency);
}

function serverMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body;
    if (typeof body === "object" && body !== null && "error" in body) {
      return String((body as { error: unknown }).error);
    }
  }
  return "Request failed.";
}

/**
 * Strict whole-number parsing for operator-entered integers. parseInt
 * silently truncates ("20.5" → 20, "20abc" → 20), submitting a different
 * value than entered; here anything but digits is null, so the form stays
 * disabled and the server (zod int + range checks) never sees a mangled
 * value either.
 */
function parseWholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

// Admin coupons (#274): the operational surface for campaign codes.
// Creation requires every constraint explicitly (the form starts empty —
// no preselected type, duration, or limits — and the server rejects
// anything missing); redeemed coupons expose deactivation only, because
// the redeemed-terms trigger underneath rejects value/limit edits and
// reactivation. Redemptions show household identifiers, never personal
// data. All reads/writes go through apiFetch (same-origin;
// NEXT_PUBLIC_API_BASE_URL routing for Tauri holds).
export default function AdminCouponsPage() {
  return (
    <AdminGate>
      <AdminCoupons />
    </AdminGate>
  );
}

function AdminCoupons() {
  const [coupons, setCoupons] = useState<AdminCoupon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await apiFetch<{ coupons: AdminCoupon[] }>("/api/admin/coupons");
      if (signal?.aborted) return;
      setCoupons(data.coupons);
      setError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setError(serverMessage(err));
    }
  }, []);

  useEffect(() => {
    setCoupons(null);
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, retryKey]);

  return (
    <div className="flex w-full flex-col gap-6">
      <Card className="w-full">
        <CardHeader>
          <h1 className="text-2xl font-black tracking-tight">Admin — coupons</h1>
          <CardDescription>
            Campaign codes with explicit constraints. Once redeemed, a coupon&apos;s terms are
            locked — deactivation is the only change.{" "}
            <Link href="/admin" className="underline">
              Back to households
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
      <CreateCouponCard onCreated={() => setRetryKey((k) => k + 1)} />
      <Card className="w-full">
        <CardHeader>
          <h2 className="text-lg font-bold">Coupons</h2>
          <CardDescription>
            Redemption counts and remaining capacity. History is never deleted — only deactivated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}{" "}
              <button type="button" className="underline" onClick={() => setRetryKey((k) => k + 1)}>
                Retry
              </button>
            </p>
          ) : coupons === null ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              Loading coupons…
            </p>
          ) : coupons.length === 0 ? (
            <p className="text-sm text-muted-foreground">No coupons yet. Create one above.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {coupons.map((c) => (
                <CouponRow key={c.code} coupon={c} onChanged={() => setRetryKey((k) => k + 1)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const EMPTY_CREATE = {
  code: "",
  discountType: "",
  discountValue: "",
  currency: "",
  validFrom: "",
  validUntil: "",
  maxRedemptions: "",
  perHouseholdLimit: "",
  duration: "",
  reason: "",
};

function CreateCouponCard({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState(EMPTY_CREATE);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = (key: keyof typeof EMPTY_CREATE) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const isAmount = form.discountType === "amount";
  const discountValue = parseWholeNumber(form.discountValue);
  const maxRedemptions = parseWholeNumber(form.maxRedemptions);
  // Per-household limit is 1 by design (one redemption row per household
  // per coupon — the server rejects anything else). The field stays
  // explicit: the operator still sets it, and the guard explains why.
  const limitIsOne = parseWholeNumber(form.perHouseholdLimit) === 1;
  const canSubmit =
    !pending &&
    form.code.trim() !== "" &&
    (form.discountType === "percent" || form.discountType === "amount") &&
    discountValue !== null &&
    (!isAmount || form.currency.trim() !== "") &&
    form.validFrom !== "" &&
    form.validUntil !== "" &&
    maxRedemptions !== null &&
    limitIsOne &&
    (form.duration === "first_period" || form.duration === "lifetime") &&
    form.reason.trim().length >= 3;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/api/admin/coupons", {
        method: "POST",
        body: {
          action: "create",
          code: form.code.trim(),
          discount_type: form.discountType,
          discount_value: discountValue,
          currency: isAmount ? form.currency.trim() : null,
          valid_from: new Date(form.validFrom).toISOString(),
          valid_until: new Date(form.validUntil).toISOString(),
          max_redemptions: maxRedemptions,
          per_household_limit: 1,
          duration: form.duration,
          reason: form.reason.trim(),
        },
      });
      setNotice(`Coupon ${form.code.trim().toUpperCase()} created.`);
      setForm(EMPTY_CREATE);
      onCreated();
    } catch (err) {
      setError(serverMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <h2 className="text-lg font-bold">Create coupon</h2>
        <CardDescription>
          Every constraint is required — type, value, window, caps, and duration. Percent carries no
          currency; amount needs one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="coupon-code">Code</Label>
            <Input
              id="coupon-code"
              value={form.code}
              onChange={(e) => set("code")(e.target.value.toUpperCase())}
              placeholder="BLOG20"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="coupon-type">Discount type</Label>
            <select
              id="coupon-type"
              value={form.discountType}
              onChange={(e) => set("discountType")(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Choose…</option>
              <option value="percent">Percent (1–100)</option>
              <option value="amount">Amount (minor units + currency)</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="coupon-value">Discount value</Label>
            <Input
              id="coupon-value"
              inputMode="numeric"
              value={form.discountValue}
              onChange={(e) => set("discountValue")(e.target.value)}
              placeholder={isAmount ? "500" : "20"}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="coupon-currency">Currency {isAmount ? "(required)" : "(none)"}</Label>
            <Input
              id="coupon-currency"
              value={form.currency}
              onChange={(e) => set("currency")(e.target.value.toUpperCase())}
              placeholder="NIO"
              autoComplete="off"
              disabled={!isAmount}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="coupon-from">Valid from</Label>
            <Input
              id="coupon-from"
              type="datetime-local"
              value={form.validFrom}
              onChange={(e) => set("validFrom")(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="coupon-until">Valid until</Label>
            <Input
              id="coupon-until"
              type="datetime-local"
              value={form.validUntil}
              onChange={(e) => set("validUntil")(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="coupon-max">Maximum redemptions</Label>
            <Input
              id="coupon-max"
              inputMode="numeric"
              value={form.maxRedemptions}
              onChange={(e) => set("maxRedemptions")(e.target.value)}
              placeholder="500"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="coupon-limit">Per-household limit (must be 1)</Label>
            <Input
              id="coupon-limit"
              inputMode="numeric"
              value={form.perHouseholdLimit}
              onChange={(e) => set("perHouseholdLimit")(e.target.value)}
              placeholder="1"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              One redemption per household is enforced by design — larger limits cannot produce
              extra rows.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="coupon-duration">Duration</Label>
            <select
              id="coupon-duration"
              value={form.duration}
              onChange={(e) => set("duration")(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Choose…</option>
              <option value="first_period">First period only</option>
              <option value="lifetime">Lifetime of the subscription</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="coupon-reason">Reason (required, recorded in the audit log)</Label>
            <Input
              id="coupon-reason"
              value={form.reason}
              onChange={(e) => set("reason")(e.target.value)}
              placeholder="Campaign reference, e.g. blogger wave March"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col justify-end gap-2 sm:col-span-2">
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="text-sm text-muted-foreground">
                {notice}
              </p>
            ) : null}
            <div>
              <Button type="submit" disabled={!canSubmit}>
                {pending ? "Creating…" : "Create coupon"}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CouponRow({ coupon: c, onChanged }: { coupon: AdminCoupon; onChanged: () => void }) {
  const [showRedemptions, setShowRedemptions] = useState(false);
  const [redemptions, setRedemptions] = useState<CouponRedemption[] | null>(null);
  const [redemptionsError, setRedemptionsError] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleRedemptions() {
    if (showRedemptions) {
      setShowRedemptions(false);
      return;
    }
    setShowRedemptions(true);
    if (redemptions !== null) return;
    try {
      const data = await apiFetch<{ redemptions: CouponRedemption[] }>(
        `/api/admin/coupons?code=${encodeURIComponent(c.code)}`,
      );
      setRedemptions(data.redemptions);
      setRedemptionsError(null);
    } catch (err) {
      setRedemptionsError(serverMessage(err));
    }
  }

  async function deactivate() {
    if (pending || reason.trim().length < 3) return;
    setPending(true);
    setError(null);
    try {
      await apiFetch("/api/admin/coupons", {
        method: "POST",
        body: { action: "set_active", code: c.code, active: false, reason: reason.trim() },
      });
      setDeactivating(false);
      setReason("");
      onChanged();
    } catch (err) {
      setError(serverMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        !c.active && "border-muted bg-muted/40 opacity-80",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-bold">{c.code}</span>
        <Badge variant={c.active ? "default" : "secondary"}>
          {c.active ? "active" : "inactive"}
        </Badge>
        <Badge variant="outline">{discountLabel(c)}</Badge>
        <Badge variant="outline">{c.duration === "lifetime" ? "lifetime" : "first period"}</Badge>
        <span className="text-sm text-muted-foreground">
          {c.redemption_count}/{c.max_redemptions} redeemed · {c.remaining_capacity} left · max{" "}
          {c.per_household_limit} per household
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        Valid {formatDate(c.valid_from)} → {formatDate(c.valid_until)} · Created{" "}
        {formatDate(c.created_at)}
      </span>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={toggleRedemptions}>
          {showRedemptions ? "Hide redemptions" : "Redemptions"}
        </Button>
        {c.active ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              setDeactivating((d) => !d);
              setError(null);
            }}
          >
            Deactivate
          </Button>
        ) : null}
      </div>
      {showRedemptions ? (
        <div className="rounded-md border bg-muted/40 p-2">
          {redemptionsError ? (
            <p role="alert" className="text-xs text-destructive">
              {redemptionsError}
            </p>
          ) : redemptions === null ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading redemptions…
            </p>
          ) : redemptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No redemptions yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {redemptions.map((r) => (
                <li key={`${r.coupon_code}-${r.household_id}`} className="font-mono text-xs">
                  {r.household_id} · {formatDateTime(r.redeemed_at)}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Household identifiers only — no personal data.
          </p>
        </div>
      ) : null}
      {deactivating ? (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
          <p className="text-sm">
            Deactivating preserves history and immediately blocks new redemptions. This is the only
            change a redeemed coupon allows.
          </p>
          <Label htmlFor={`deactivate-reason-${c.code}`}>Reason (required)</Label>
          <Input
            id={`deactivate-reason-${c.code}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this code being withdrawn?"
            autoComplete="off"
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending || reason.trim().length < 3}
              onClick={deactivate}
            >
              {pending ? "Deactivating…" : "Confirm deactivation"}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
