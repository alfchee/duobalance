"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "@/hooks/useSession";
import { useHousehold } from "@/hooks/useHousehold";
import { HouseholdPicker } from "@/components/household/household-picker";
import { HouseholdOnboarding } from "@/components/household/household-onboarding";
import { BottomNav } from "@/components/nav/bottom-nav";
import { AppSidebar } from "@/components/nav/app-sidebar";
import { TransactionEntrySheet } from "@/components/transactions/transaction-entry-sheet";
import { FullPageSpinner } from "@/components/full-page-spinner";
import { RealtimeStatus } from "@/components/realtime-status";
import { HouseholdSwitcher } from "@/components/household/household-switcher";

// AC (#14): auth guarding happens client-side here, never in middleware.ts —
// middleware doesn't exist in a static export (architecture rule #1).
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const { loading: householdLoading, needsPicker, householdId, memberships } = useHousehold();
  const t = useTranslations("household");
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    if (!sessionLoading && !session) {
      router.replace("/login");
    }
  }, [sessionLoading, session, router]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateKeyboardState = () => setKeyboardOpen(window.innerHeight - viewport.height > 160);
    updateKeyboardState();
    viewport.addEventListener("resize", updateKeyboardState);
    return () => viewport.removeEventListener("resize", updateKeyboardState);
  }, []);

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
    <div className="flex min-h-dvh">
      <AppSidebar />
      <div className="min-w-0 flex-1">
        <RealtimeStatus>
          <HouseholdSwitcher />
          <div className="min-w-0">{children}</div>
          <TransactionEntrySheet />
          {!keyboardOpen ? <BottomNav /> : null}
        </RealtimeStatus>
      </div>
    </div>
  );
}
