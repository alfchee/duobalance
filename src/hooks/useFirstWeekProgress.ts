"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { addDays, dateInHousehold, diffDaysInclusive, todayInHousehold } from "@/lib/dates";

const TOTAL_DAYS = 7;

function requireSupabase() {
  const supabase = createSupabaseBrowser();
  if (!supabase) throw new Error("supabase not configured");
  return supabase;
}

export type FirstWeekProgress = {
  isLoading: boolean;
  householdCreatedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  today: string | null;
  daysRecorded: number;
  totalDays: number;
  distinctDays: string[];
  isWithinWeek: boolean;
  isPastWeek: boolean;
  isBeforeWeek: boolean;
  isWeekComplete: boolean;
  daysElapsed: number;
  daysSinceStart: number;
};

export function useFirstWeekProgress(
  householdId: string | null,
  timezone: string | null,
): FirstWeekProgress {
  const { data: household, isLoading: householdLoading } = useQuery({
    queryKey: ["households", householdId, "first-week-created-at"],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from("households")
        .select("created_at")
        .eq("id", householdId!)
        .single();
      if (error) throw error;
      return data as { created_at: string };
    },
    enabled: !!householdId,
  });

  const startDate =
    household && timezone ? dateInHousehold(timezone, new Date(household.created_at)) : null;
  const endDate = startDate ? addDays(startDate, TOTAL_DAYS - 1) : null;
  const today = timezone ? todayInHousehold(timezone) : null;

  const daysSinceStart = (() => {
    if (!startDate || !today) return 0;
    if (today < startDate) return 0;
    return diffDaysInclusive(startDate, today);
  })();

  const daysElapsed = (() => {
    if (!startDate || !today) return 0;
    if (today < startDate) return 0;
    if (today > (endDate as string)) return TOTAL_DAYS;
    return diffDaysInclusive(startDate, today);
  })();

  const isWithinWeek =
    !!startDate && !!endDate && !!today && today >= startDate && today <= endDate;
  const isPastWeek = !!endDate && !!today && today > endDate;
  const isBeforeWeek = !!startDate && !!today && today < startDate;
  const isWeekComplete = !!endDate && !!today && today >= endDate;

  const { data: occurredDates = [], isLoading: txLoading } = useQuery({
    queryKey: ["transactions", householdId, "first-week", startDate, endDate],
    queryFn: async () => {
      if (!householdId || !startDate || !endDate) return [] as string[];
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("transactions")
        .select("occurred_on")
        .eq("household_id", householdId)
        .gte("occurred_on", startDate)
        .lte("occurred_on", endDate)
        // Only count real spending/income days — exclude both legs of a
        // transfer (transfer_group_id invariant: null => non-transfer).
        .is("transfer_group_id", null);
      if (error) throw error;
      return (data ?? []).map((row) => row.occurred_on as string);
    },
    enabled: !!householdId && !!startDate && !!endDate,
  });

  const distinctDays = [...new Set(occurredDates)].sort();
  const daysRecorded = distinctDays.length;

  const isLoading = householdLoading || txLoading;

  return {
    isLoading,
    householdCreatedAt: household?.created_at ?? null,
    startDate,
    endDate,
    today,
    daysRecorded,
    totalDays: TOTAL_DAYS,
    distinctDays,
    isWithinWeek,
    isPastWeek,
    isBeforeWeek,
    isWeekComplete,
    daysElapsed,
    daysSinceStart,
  };
}
