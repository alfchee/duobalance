// WARNING: Service role. ONLY import from app/api/** route handlers.
// The ESLint config in eslint.config.mjs enforces this restriction.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";
import { env } from "@/lib/env";

export async function createSupabaseRouteHandler() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Supabase env not set — see issue #9");
  }
  const cookieStore = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
    },
  });
}
