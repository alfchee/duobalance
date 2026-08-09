// Shared route-handler helpers. Server-only — this file lives under app/api/**
// and imports the service-role client, so it must never be imported from
// client code. The service role bypasses RLS, so authorization is explicit
// here: every handler verifies the caller's JWT via getUser() and then checks
// ownership directly.

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getAuthedUser(supabase: SupabaseClient<Database>) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new HttpError(401, "authentication required");
  return user;
}

export async function createRouteContext() {
  return createSupabaseRouteHandler();
}
