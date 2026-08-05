"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocaleProvider } from "@/components/locale-provider";
import { SessionProvider } from "@/components/session-provider";
import { HouseholdProvider } from "@/components/household-provider";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <SessionProvider>
          <HouseholdProvider>{children}</HouseholdProvider>
        </SessionProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
