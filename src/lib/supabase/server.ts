// WARNING: Service role. ONLY import from app/api/** route handlers.
// The ESLint config in eslint.config.mjs enforces this restriction.
//
// SUPABASE_SERVICE_ROLE_KEY is read directly here rather than through
// lib/env.ts on purpose: env.ts is also imported by lib/supabase/client.ts
// (browser-reachable), and a shared schema referencing the service-role key
// would put that identifier — and Next's static replacement of it — in the
// client bundle. Keeping it isolated to this file is what the leak guard's
// allowlist (see CLAUDE.md) actually checks for.

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { z } from "zod";
import type { Database } from "./types";
import { env } from "@/lib/env";

function getServiceRoleKey(): string | undefined {
  return z
    .string()
    .min(1)
    .optional()
    .parse(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY);
}

export async function createSupabaseRouteHandler() {
  const serviceRoleKey = getServiceRoleKey();
  if (!serviceRoleKey || !env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Supabase env not set — see issue #9");
  }
  const cookieStore = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch (error) {
          // Route handlers are writable, but Server Components are not —
          // log so a TOKEN_REFRESHED that cannot persist surfaces in
          // `wrangler tail` instead of silently dropping the session
          // after jwt_expiry. workerd's cookie polyfill surfaces here
          // if the compat layer changes.
          console.warn("[supabase] setAll failed — session refresh may not persist", error);
        }
      },
    },
  });
}

export function createSupabaseServiceRoleClient() {
  const serviceRoleKey = getServiceRoleKey();
  if (!serviceRoleKey || !env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Supabase env not set — see issue #9");
  }
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
