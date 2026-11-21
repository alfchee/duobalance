"use client";

import type { ReactNode } from "react";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";

// Gate for every billing surface: checkout buttons, plan gates, upgrade
// prompts and admin billing screens (issue #262, full surfaces in #264 and
// #271-#275). While the billing exposure flag is off the children are not
// rendered at all — no route, button or screen may expose billing to a user.
//
// ```tsx
// <BillingGate>
//   <UpgradeButton />
// </BillingGate>
// ```
export function BillingGate({ children }: { children: ReactNode }) {
  const billingEnabled = useBillingEnabled();
  if (!billingEnabled) return null;
  return <>{children}</>;
}
