"use client";

import { isBillingEnabled } from "@/lib/billing/enabled";

// Client mirror of the billing exposure flag (issue #262). Reads the
// NEXT_PUBLIC_ mirror through the single accessor — never process.env
// directly — so checkout buttons, plan gates and admin billing screens can
// hide themselves while billing is not live.
//
// NOTE: the value is inlined at build time (NEXT_PUBLIC_*). A flag flip
// needs a redeploy; that is intentional — flipping billing live must be a
// deliberate deploy, per the go-live checklist in docs/billing-go-live-checklist.md.
export function useBillingEnabled(): boolean {
  return isBillingEnabled();
}
