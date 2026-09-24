"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEntitlement } from "@/hooks/useEntitlement";

// Approaching-limit indicator for counted features (issue #264).
//
// Appears BEFORE the limit is hit: from 75% of the plan limit onward, and
// stays silent once the limit is actually reached — at that point the
// database rejects the write and the surrounding surface owns the message.
// A no-op while billing is off (`useEntitlement` bypasses to unlimited) and
// for explicitly unlimited plans, so the free tier's countdown never shows
// where no limit exists.
const APPROACH_THRESHOLD = 0.75;

export function LimitApproaching({
  householdId,
  feature,
  used,
}: {
  householdId: string | null;
  feature: string;
  used: number;
}) {
  const t = useTranslations("billing.limits");
  const tFeatures = useTranslations("settings.plan.features");
  const locale = useLocale();
  const { entitled, limit, unlimited, pending } = useEntitlement(householdId, feature);

  if (pending || !entitled || unlimited) return null;
  // Number formatting follows the app locale, not the household's currency
  // format — these are counts, not money.
  const fmt = new Intl.NumberFormat(locale);
  if (used >= limit) {
    return (
      <p role="status" className="text-sm text-amber-600 dark:text-amber-400">
        {t("atLimit", { label: tFeatures(feature), limit: fmt.format(limit) })}
      </p>
    );
  }
  const threshold = Math.max(1, Math.ceil(limit * APPROACH_THRESHOLD));
  if (used < threshold) return null;
  return (
    <p role="status" className="text-sm text-amber-600 dark:text-amber-400">
      {t("approaching", {
        label: tFeatures(feature),
        used: fmt.format(used),
        limit: fmt.format(limit),
      })}
    </p>
  );
}
