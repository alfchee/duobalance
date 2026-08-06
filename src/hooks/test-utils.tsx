import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { createSupabaseBrowser } from "@/lib/supabase/client";

// Hooks test in isolation from retry storms: a query error surfaces on the
// first render instead of retrying forever.
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export function QueryWrapper({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

type ChainResult = { data?: unknown; error?: unknown };

// Fake PostgREST builder: select/eq/is/order are chainable and the terminal
// `.order()` resolves with `result`. The returned mock fns let tests assert on
// the table and filters the hook applied.
export function mockSupabase(result: ChainResult) {
  const order = vi.fn().mockResolvedValue(result);
  const is = vi.fn().mockReturnValue({ order });
  const eq = vi.fn().mockReturnValue({ is, order });
  const select = vi.fn().mockReturnValue({ eq, is, order });
  const from = vi.fn().mockReturnValue({ select });
  vi.mocked(createSupabaseBrowser).mockReturnValue({ from } as unknown as ReturnType<
    typeof createSupabaseBrowser
  >);
  return { from, select, eq, is, order };
}
