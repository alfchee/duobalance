"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api-fetch";
import {
  acceptInvite,
  clearActiveHouseholdId,
  createHousehold,
  deleteHousehold,
  leaveHousehold,
  readActiveHouseholdId,
  removeMemberWorkflow,
  saveActiveHouseholdId,
  transferOwnership as transferOwnershipWorkflow,
  type HouseholdResult,
} from "@/lib/household/workflows";

const MEMBERSHIP_QUERY_KEY = ["households", "memberships"] as const;

export function useHouseholdCommands() {
  const queryClient = useQueryClient();

  const create = useCallback(
    async (input: { name: string; country: string; baseCurrency: string; displayName: string }) => {
      const supabase = createSupabaseBrowser();
      const result = await createHousehold(
        supabase
          ? async (values) => {
              const { error } = await supabase.rpc("create_household", values);
              return { error };
            }
          : null,
        input,
      );
      if (result.ok) await queryClient.invalidateQueries({ queryKey: MEMBERSHIP_QUERY_KEY });
      return result;
    },
    [queryClient],
  );

  const accept = useCallback(
    async (token: string): Promise<HouseholdResult<{ householdId: string | null }>> => {
      const supabase = createSupabaseBrowser();
      const result = await acceptInvite(
        supabase
          ? async (values) => {
              const { data, error } = await supabase.rpc("accept_invite", values);
              return { data: data ? String(data) : null, error };
            }
          : null,
        token,
      );
      if (result.ok) {
        if (result.value.householdId) saveActiveHouseholdId(localStorage, result.value.householdId);
        await queryClient.invalidateQueries({ queryKey: MEMBERSHIP_QUERY_KEY });
      }
      return result;
    },
    [queryClient],
  );

  const removeHousehold = useCallback(
    async (householdId: string): Promise<HouseholdResult<undefined>> => {
      const supabase = createSupabaseBrowser();
      const result = await deleteHousehold(
        supabase
          ? async (values) => {
              const { error } = await supabase.rpc("delete_household", values);
              return { error };
            }
          : null,
        householdId,
      );
      if (result.ok) {
        if (typeof window !== "undefined") {
          const current = readActiveHouseholdId(localStorage);
          if (current === householdId) clearActiveHouseholdId(localStorage);
        }
        await queryClient.invalidateQueries({ queryKey: MEMBERSHIP_QUERY_KEY });
      }
      return result;
    },
    [queryClient],
  );

  const leave = useCallback(
    async (householdId: string): Promise<HouseholdResult<undefined>> => {
      const supabase = createSupabaseBrowser();
      const result = await leaveHousehold(
        supabase
          ? async (values) => {
              const { error } = await supabase.rpc("leave_household", values);
              return { error };
            }
          : null,
        householdId,
      );
      if (result.ok) {
        if (typeof window !== "undefined") {
          const current = readActiveHouseholdId(localStorage);
          if (current === householdId) clearActiveHouseholdId(localStorage);
        }
        await queryClient.invalidateQueries({ queryKey: MEMBERSHIP_QUERY_KEY });
      }
      return result;
    },
    [queryClient],
  );

  const transferOwnership = useCallback(
    async (
      householdId: string,
      newOwnerMemberId: string,
      demoteSelf = false,
    ): Promise<HouseholdResult<undefined>> => {
      const supabase = createSupabaseBrowser();
      const result = await transferOwnershipWorkflow(
        supabase
          ? async (values) => {
              const { error } = await supabase.rpc("transfer_ownership", values);
              return { error };
            }
          : null,
        householdId,
        newOwnerMemberId,
        demoteSelf,
      );
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: MEMBERSHIP_QUERY_KEY });
        await queryClient.invalidateQueries({ queryKey: ["household_members"] });
      }
      return result;
    },
    [queryClient],
  );

  const removeMember = useCallback(
    async (
      householdId: string,
      memberId: string,
      accountDisposition: Record<string, "transfer" | "joint"> = {},
    ): Promise<HouseholdResult<undefined>> => {
      const result = await removeMemberWorkflow(
        async (values) => {
          try {
            await apiFetch("/api/members/remove", {
              method: "POST",
              body: JSON.stringify(values),
            });
            return { error: null };
          } catch (err) {
            return { error: err };
          }
        },
        householdId,
        memberId,
        accountDisposition,
      );
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: MEMBERSHIP_QUERY_KEY });
        await queryClient.invalidateQueries({ queryKey: ["household_members"] });
        await queryClient.invalidateQueries({ queryKey: ["accounts"] });
        await queryClient.invalidateQueries({ queryKey: ["bills"] });
      }
      return result;
    },
    [queryClient],
  );

  return { create, accept, removeHousehold, leave, transferOwnership, removeMember };
}
