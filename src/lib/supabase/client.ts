"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";
import { env } from "@/lib/env";

export function createSupabaseBrowser() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Build is allowed to succeed before #9 provisions the project.
    // Real callers will get null back and can render a "not configured" UI.
    return null;
  }
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
