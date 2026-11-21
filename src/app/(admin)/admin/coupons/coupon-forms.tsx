"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { adminApiErrorMessage } from "@/components/admin/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseWholeNumber } from "./coupon-types";

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

export function CreateCouponCard({ onCreated }: { onCreated: () => void }) {
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
      setError(adminApiErrorMessage(err, "Request failed."));
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
