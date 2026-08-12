"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { pendingInvitePath } from "@/lib/pending-invite";
import { clearActiveHouseholdId } from "@/lib/household/workflows";
import {
  requestPasswordReset,
  resetPassword,
  signIn,
  signUp,
  type AuthResult,
  type PostAuthDestination,
  type SignupNextStep,
} from "@/lib/auth/flows";

export function useAuthCommands() {
  const queryClient = useQueryClient();

  const login = useCallback(
    (input: {
      email: string;
      password: string;
    }): Promise<AuthResult<{ redirectTo: PostAuthDestination }>> => {
      const supabase = createSupabaseBrowser();
      return signIn(supabase?.auth.signInWithPassword.bind(supabase.auth) ?? null, {
        ...input,
        pendingInvitePath: pendingInvitePath(),
      });
    },
    [],
  );

  const signup = useCallback(
    (input: {
      displayName: string;
      email: string;
      password: string;
    }): Promise<
      AuthResult<{ nextStep: SignupNextStep; redirectTo: PostAuthDestination | null }>
    > => {
      const supabase = createSupabaseBrowser();
      return signUp(supabase?.auth.signUp.bind(supabase.auth) ?? null, {
        ...input,
        pendingInvitePath: pendingInvitePath(),
      });
    },
    [],
  );

  const requestReset = useCallback((input: { email: string; origin: string }) => {
    const supabase = createSupabaseBrowser();
    return requestPasswordReset(
      supabase?.auth.resetPasswordForEmail.bind(supabase.auth) ?? null,
      input,
    );
  }, []);

  const completePasswordReset = useCallback(
    (input: { password: string; confirmPassword: string }) => {
      const supabase = createSupabaseBrowser();
      return resetPassword(
        supabase
          ? {
              updatePassword: supabase.auth.updateUser.bind(supabase.auth),
              signOut: supabase.auth.signOut.bind(supabase.auth),
            }
          : null,
        input,
      );
    },
    [],
  );

  const logout = useCallback(async () => {
    const supabase = createSupabaseBrowser();
    await supabase?.auth.signOut();
    queryClient.clear();
    if (typeof localStorage !== "undefined") clearActiveHouseholdId(localStorage);
  }, [queryClient]);

  return { login, signup, requestReset, completePasswordReset, logout };
}
