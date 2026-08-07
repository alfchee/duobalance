"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "@/hooks/useSession";
import { useHousehold } from "@/hooks/useHousehold";
import { HouseholdPicker } from "@/components/household/household-picker";
import { HouseholdOnboarding } from "@/components/household/household-onboarding";
import { BottomNav } from "@/components/nav/bottom-nav";
import { FullPageSpinner } from "@/components/full-page-spinner";

// AC (#14): auth guarding happens client-side here, never in middleware.ts —
// middleware doesn't exist in a static export (architecture rule #1).
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const { loading: householdLoading, needsPicker, householdId, memberships } = useHousehold();
  const t = useTranslations("household");

  useEffect(() => {
    if (!sessionLoading && !session) {
      router.replace("/login");
    }
  }, [sessionLoading, session, router]);

  if (sessionLoading || !session) {
    return <FullPageSpinner />;
  }

  if (householdLoading) {
    return <FullPageSpinner label={t("loading")} />;
  }

  if (needsPicker) {
    return <HouseholdPicker />;
  }

  if (!householdId || memberships.length === 0) {
    return <HouseholdOnboarding />;
  }

  return (
    <>
      <div className="pb-16">{children}</div>
      <BottomNav />
    </>
  );
}
