"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/hooks/useSession";
import { toSupportedLocale, useLocaleContext } from "@/components/locale-provider";
import type { Database } from "@/lib/supabase/types";

type MemberRole = Database["public"]["Enums"]["household_member_role"];

export type Membership = {
  memberId: string;
  householdId: string;
  role: MemberRole;
  displayName: string;
  household: {
    name: string;
    country: string;
    baseCurrency: string;
    timezone: string;
    locale: string;
  };
};

type HouseholdContextValue = {
  loading: boolean;
  error: Error | null;
  memberships: Membership[];
  active: Membership | null;
  needsPicker: boolean;
  selectHousehold: (householdId: string) => void;
};

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

const ACTIVE_HOUSEHOLD_STORAGE_KEY = "duobalance:activeHouseholdId";

async function fetchMemberships(userId: string): Promise<Membership[]> {
  const supabase = createSupabaseBrowser();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("household_members")
    .select(
      "id, household_id, role, display_name, households(name, country, base_currency, timezone, locale)",
    )
    .eq("user_id", userId);

  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    const household = row.households;
    if (!household) return [];
    return [
      {
        memberId: row.id,
        householdId: row.household_id,
        role: row.role,
        displayName: row.display_name,
        household: {
          name: household.name,
          country: household.country,
          baseCurrency: household.base_currency,
          timezone: household.timezone,
          locale: household.locale,
        },
      },
    ];
  });
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user, loading: sessionLoading } = useSession();
  const { hasStoredPreference, setLocale } = useLocaleContext();
  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setActiveHouseholdId(localStorage.getItem(ACTIVE_HOUSEHOLD_STORAGE_KEY));
    setHydrated(true);
  }, []);

  const {
    data: memberships,
    isLoading: membershipsLoading,
    error,
  } = useQuery({
    queryKey: ["households", "memberships", user?.id],
    queryFn: () => fetchMemberships(user?.id as string),
    enabled: !!user?.id && hydrated,
  });

  const list = useMemo(() => memberships ?? [], [memberships]);

  const active = useMemo(() => {
    if (list.length === 0) return null;
    if (list.length === 1) return list[0] ?? null;
    return list.find((m) => m.householdId === activeHouseholdId) ?? null;
  }, [list, activeHouseholdId]);

  // A single household needs no explicit choice — keep localStorage in sync
  // so a later second household doesn't silently inherit a stale selection.
  useEffect(() => {
    if (list.length === 1 && list[0] && list[0].householdId !== activeHouseholdId) {
      localStorage.setItem(ACTIVE_HOUSEHOLD_STORAGE_KEY, list[0].householdId);
      setActiveHouseholdId(list[0].householdId);
    }
  }, [list, activeHouseholdId]);

  // Locale resolution order (household -> browser -> es, per #16): only
  // adopt the household's locale when the user has never made an explicit
  // choice, so a manual override (once #16 ships a switcher) always wins.
  useEffect(() => {
    if (active && !hasStoredPreference) {
      setLocale(toSupportedLocale(active.household.locale));
    }
  }, [active, hasStoredPreference, setLocale]);

  function selectHousehold(householdId: string) {
    localStorage.setItem(ACTIVE_HOUSEHOLD_STORAGE_KEY, householdId);
    setActiveHouseholdId(householdId);
  }

  const loading = sessionLoading || (!!user && (!hydrated || membershipsLoading));

  return (
    <HouseholdContext.Provider
      value={{
        loading,
        error: error as Error | null,
        memberships: list,
        active,
        needsPicker: !loading && list.length > 1 && !active,
        selectHousehold,
      }}
    >
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHouseholdContext(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext);
  if (!ctx) {
    throw new Error("useHouseholdContext must be used within a HouseholdProvider");
  }
  return ctx;
}
