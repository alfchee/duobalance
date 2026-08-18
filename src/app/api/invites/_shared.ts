// Shared route-handler helpers for the invite flow (#15). Server-only —
// this file is under app/api/** and imports the service-role client, so it
// must never be imported from client code. The service role bypasses RLS, so
// authorization is explicit here: every handler verifies the caller's JWT
// via getUser() and then checks ownership directly.
//
// The generic helpers (HttpError, getAuthedUser, createRouteContext) live in
// app/api/_shared.ts and are re-exported here so invite routes keep importing
// from a single local module.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createRouteContext, getAuthedUser, HttpError } from "../_shared";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export { getAuthedUser, HttpError };

export async function createInviteRouteContext() {
  const [auth, admin] = await Promise.all([
    createRouteContext(),
    createSupabaseServiceRoleClient(),
  ]);
  return { auth, admin };
}

// Verifies the caller is the owner of `householdId` and returns their member
// row (id + display_name) plus the household name/locale for the email.
export async function requireOwner(
  supabase: SupabaseClient<Database>,
  userId: string,
  householdId: string,
) {
  const { data: member, error } = await supabase
    .from("household_members")
    .select("id, role, display_name, households(name, locale)")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!member || member.role !== "owner") {
    throw new HttpError(403, "household ownership required");
  }

  return member;
}

// Records a send attempt; the invite_sends trigger rejects the 11th send
// within the hour (migration 16) with a distinct error we map to 429.
export async function recordInviteSend(supabase: SupabaseClient<Database>, userId: string) {
  const { error } = await supabase.from("invite_sends").insert({ user_id: userId });
  if (error) {
    if (error.message.includes("invite rate limit exceeded")) {
      throw new HttpError(429, "invite rate limit exceeded");
    }
    throw error;
  }
}
