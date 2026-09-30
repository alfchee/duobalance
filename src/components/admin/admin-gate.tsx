"use client";

import { useEffect, useState, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";

// AdminGate (#271): the client-side door to /admin. Renders children only
// for rostered admins; everyone else sees the framework not-found boundary
// — a neutral denial that reveals nothing about whether the resource
// exists. While billing is off the admin surface does not exist yet, so
// the gate also renders nothing (the API returns 404 in that state too).
export function AdminGate({ children }: { children: ReactNode }) {
  const billingEnabled = useBillingEnabled();
  const [state, setState] = useState<"checking" | "ok" | "denied">("checking");

  useEffect(() => {
    if (!billingEnabled) {
      setState("denied");
      return;
    }
    let cancelled = false;
    apiFetch<{ isAdmin: boolean }>("/api/admin/me")
      .then(() => {
        if (!cancelled) setState("ok");
      })
      .catch(() => {
        if (cancelled) return;
        // Any failure — 404 neutral denial included — is a denial. Only
        // 5xx surfaces differently, and even then as not-found: a support
        // tool must never leak its own health to an unauthenticated probe.
        setState("denied");
      });
    return () => {
      cancelled = true;
    };
  }, [billingEnabled]);

  if (state === "checking") {
    return (
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        Checking access…
      </p>
    );
  }
  if (state === "denied") {
    notFound();
  }
  return <>{children}</>;
}
