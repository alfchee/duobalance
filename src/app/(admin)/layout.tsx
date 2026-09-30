import type { ReactNode } from "react";

// Admin deployment shell (#271). Rendered for /admin/* only. Deliberately
// separate from the user-app shell in src/app/(app)/layout.tsx: no household
// context, no household switcher, no transaction entry points — an admin
// session never implies a household session. Auth is verified per request
// by the API (neutral 404 for non-admins); this layout carries no session
// and grants nothing by itself.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh w-full justify-center bg-secondary/70 px-4 py-8 sm:p-8">
      <div className="flex w-full max-w-4xl flex-col gap-6">{children}</div>
    </main>
  );
}
