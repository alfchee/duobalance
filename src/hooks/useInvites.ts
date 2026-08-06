"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { createSupabaseBrowser } from "@/lib/supabase/client";

export type PendingInvite = {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
};

// Pending invites are read through RLS (any member may SELECT household_invites).
// The token column is deliberately not selected — it never leaves the server.
export function usePendingInvites(householdId: string | null) {
  return useQuery({
    queryKey: ["invites", householdId],
    queryFn: async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase) throw new Error("supabase not configured");
      const { data, error } = await supabase
        .from("household_invites")
        .select("id, email, created_at, expires_at")
        .eq("household_id", householdId!)
        .is("accepted_at", null)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!householdId,
  });
}

// Mutations run through the /api/invites route handlers: household_invites has
// no INSERT/UPDATE/DELETE policy under RLS, and the handlers own token
// generation + the Resend call.
export function useInviteMutations(householdId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["invites", householdId] });

  const create = useMutation({
    mutationFn: (email: string) =>
      apiFetch<{ id: string }>("/api/invites", {
        method: "POST",
        body: { household_id: householdId, email },
      }),
    onSuccess: invalidate,
  });

  const revoke = useMutation({
    mutationFn: (inviteId: string) => apiFetch(`/api/invites/${inviteId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const resend = useMutation({
    mutationFn: (inviteId: string) =>
      apiFetch<{ id: string }>(`/api/invites/${inviteId}/resend`, { method: "POST" }),
    onSuccess: invalidate,
  });

  return { create, revoke, resend };
}
