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

const serviceRoleKey = z.string().min(1).optional().parse(process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function createSupabaseRouteHandler() {
  if (!serviceRoleKey || !env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Supabase env not set — see issue #9");
  }
  const cookieStore = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
    },
  });
}

export function createSupabaseServiceRoleClient() {
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
