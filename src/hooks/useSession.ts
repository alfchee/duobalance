"use client";

import { useSessionContext } from "@/components/session-provider";

// Session state resolved once at the root (SessionProvider) and shared via
// context — every screen that needs auth state reads it through this hook
// rather than subscribing to Supabase directly.
export function useSession() {
  const { session, loading, configured } = useSessionContext();
  return {
    session,
    user: session?.user ?? null,
    loading,
    configured,
  };
}
