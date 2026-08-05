"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { env, supabaseClientKey } from "@/lib/env";

let client: SupabaseClient<Database> | null = null;

export function createSupabaseBrowser() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !supabaseClientKey) {
    // Build is allowed to succeed before #9 provisions the project.
    // Real callers will get null back and can render a "not configured" UI.
    return null;
  }
  // One browser client for the whole app: a fresh client per call would
  // duplicate auth-state subscriptions and broadcast channels in the tree.
  client ??= createBrowserClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, supabaseClientKey);
  return client;
}
