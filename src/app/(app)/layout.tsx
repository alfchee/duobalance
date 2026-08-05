import type { ReactNode } from "react";

// No-op shell. #14 replaces this with a client-side useSession() guard
// and a HouseholdProvider, plus the bottom nav.
export default function AppLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
