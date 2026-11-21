"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useEntitlement } from "@/hooks/useEntitlement";

// Plan gating in the UI (issue #264, epic #255).
//
// FeatureGate renders the gated feature in place of nothing: while the
// caller is entitled (or while the billing exposure flag is off — the #262
// fail-open rule makes every gate a no-op) it renders `children`; otherwise
// it renders an upgrade prompt that explains what the feature does and
// offers the upgrade. The tone rule from the issue: never imply the user
// did something wrong — every prompt states that their saved data is
// untouched.
//
// A gate is only legitimate when the database enforces the same
// restriction (RLS from #261 or a route-handler check against the same
// helpers). A gate with no counterpart is decoration — see the PR
// description for the gate ↔ restriction table.
export function FeatureGate({
  householdId,
  feature,
  children,
}: {
  householdId: string | null;
  feature: string;
  children: ReactNode;
}) {
  const { entitled, pending } = useEntitlement(householdId, feature);

  // Never flash a gated feature while the entitlement resolves.
  if (pending) return null;
  if (entitled) return <>{children}</>;
  return <UpgradePrompt />;
}

export function UpgradePrompt() {
  const t = useTranslations("billing.upgrade");
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles aria-hidden className="size-4 text-primary" />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("dataSafe")}</p>
      </CardContent>
      <CardFooter>
        <Button asChild size="sm">
          <Link href="/settings#plan">{t("cta")}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
