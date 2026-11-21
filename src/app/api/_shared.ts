// Shared route-handler helpers. Server-only — this file lives under app/api/**
// and imports the service-role client, so it must never be imported from
// client code. The service role bypasses RLS, so authorization is explicit
// here: every handler verifies the caller's JWT via getUser() and then checks
// ownership directly.

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getAuthedUser(supabase: SupabaseClient<Database>, accessToken?: string) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);
  if (error || !user) throw new HttpError(401, "authentication required");
  return user;
}

export async function createRouteContext() {
  return createSupabaseRouteHandler();
}

export type RequireUserOk = {
  supabase: SupabaseClient<Database>;
  user: User;
};

/**
 * The shared route preamble (was copy-pasted across the account, export,
 * and exports routes): Tauri guard, not-configured guard, route context,
 * and JWT verification. Returns the context + user, or a `response` the
 * handler must return directly:
 *
 *   const auth = await requireUser();
 *   if ("response" in auth) return auth.response;
 *   const { supabase, user } = auth;
 */
export async function requireUser(): Promise<RequireUserOk | { response: Response }> {
  if (process.env.BUILD_TARGET === "tauri") {
    return { response: Response.json({ error: "unavailable" }, { status: 401 }) };
  }
  if (
    (!process.env.NEXT_PUBLIC_SUPABASE_URL ||
      (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY)) &&
    process.env.NODE_ENV === "production"
  ) {
    return { response: Response.json({ error: "not configured" }, { status: 200 }) };
  }

  const supabase = await createRouteContext();
  try {
    const user = await getAuthedUser(supabase);
    return { supabase, user };
  } catch (error) {
    if (error instanceof HttpError) {
      return {
        response: Response.json({ error: "authentication required" }, { status: error.status }),
      };
    }
    throw error;
  }
}
