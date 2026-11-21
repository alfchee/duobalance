"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { adminApiErrorMessage } from "@/components/admin/format";
import { AdminGate } from "@/components/admin/admin-gate";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { CouponRow } from "./coupon-detail";
import { CreateCouponCard } from "./coupon-forms";
import type { AdminCoupon } from "./coupon-types";

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
      setError(adminApiErrorMessage(err, "Request failed."));
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
