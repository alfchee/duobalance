"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { adminApiErrorMessage, formatDate, formatDateTime } from "@/components/admin/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { discountLabel, type AdminCoupon, type CouponRedemption } from "./coupon-types";

export function CouponRow({
  coupon: c,
  onChanged,
}: {
  coupon: AdminCoupon;
  onChanged: () => void;
}) {
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
      setRedemptionsError(adminApiErrorMessage(err, "Request failed."));
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
      setError(adminApiErrorMessage(err, "Request failed."));
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
