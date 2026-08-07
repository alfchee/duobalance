"use client";

import { useTranslations } from "next-intl";
import { useHouseholdMembers } from "@/hooks/useHouseholdMembers";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";

// Owner badge on a Balances row (issue #21). Joint (owner null) renders with
// the muted "Joint" label. A private account has a single member as its owner
// — the badge uses their color_hex; null falls back to a neutral tone so an
// unset color doesn't break the layout.
export function OwnerBadge({ account, className }: { account: Account; className?: string }) {
  const t = useTranslations("balances");
  const { data: members } = useHouseholdMembers(account.household_id);
  const ownerMemberId = account.owner_member_id;
  const owner = ownerMemberId ? members?.find((m) => m.id === ownerMemberId) : null;
  const isJoint = ownerMemberId == null;
  const displayName = owner?.display_name ?? (isJoint ? t("jointLabel") : "");
  const color = isJoint ? null : (owner?.color_hex ?? null);

  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        isJoint ? "border border-muted-foreground/30 text-muted-foreground" : "text-white",
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
      title={displayName}
    >
      {isJoint ? t("jointLabel") : (owner?.display_name ?? t("jointLabel"))}
    </span>
  );
}
