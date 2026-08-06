import { afterEach, describe, expect, it, vi } from "vitest";

// env.ts parses process.env once at module load, so each test reloads it with
// a controlled environment.
const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_API_BASE_URL",
] as const;

async function loadEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return await import("./env");
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("env", () => {
  it("defaults the API base URL to an empty string", async () => {
    const { env } = await loadEnv({});
    expect(env.NEXT_PUBLIC_API_BASE_URL).toBe("");
  });

  it("prefers the publishable key over anon for the client key", async () => {
    const { supabaseClientKey } = await loadEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pub-key",
    });
    expect(supabaseClientKey).toBe("pub-key");
  });

  it("falls back to the anon key when publishable is absent", async () => {
    const { supabaseClientKey } = await loadEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });
    expect(supabaseClientKey).toBe("anon-key");
  });

  it("yields a null client key when neither key is set", async () => {
    const { supabaseClientKey } = await loadEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    });
    expect(supabaseClientKey).toBeNull();
  });

  it("rejects a Supabase URL that is not a valid URL", async () => {
    await expect(loadEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" })).rejects.toThrow();
  });

  it("rejects an empty anon key", async () => {
    await expect(loadEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "" })).rejects.toThrow();
  });
});
