// Service-role client for Cloudflare scheduled() — intentionally separate from
// `lib/supabase/server.ts` which imports `next/headers` (only available in
// Next server context). Importing `server.ts` from `worker.ts` would bundle
// `next/headers` into the Worker and crash at import time even for scheduled
// invocations. This module has no Next dependency.

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "./types";
import { env } from "@/lib/env";

function getServiceRoleKey(): string | undefined {
  return z.string().min(1).optional().parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function createSupabaseCronClient(
  cloudflareEnv: Record<string, unknown>,
): ReturnType<typeof createClient<Database>> {
  const url =
    (cloudflareEnv.NEXT_PUBLIC_SUPABASE_URL as string | undefined) ??
    env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    (cloudflareEnv.SUPABASE_SERVICE_ROLE_KEY as string | undefined) ??
    getServiceRoleKey() ??
    (process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined);
  if (!key || !url) {
    throw new Error("Supabase env not set — see issue #9");
  }
  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
