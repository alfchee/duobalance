# Store convention

- One file per domain: `accounts.ts`, `transactions.ts`, `budget.ts`, `bills.ts`, etc.
- Use **Zustand** for ephemeral client state (filter UI, drafts, modal open/closed) and
  **TanStack Query** for server cache. Do not pick a global store.
- Hooks live alongside the store file: `useBalances()`, `useTransactions()`.
- Store files are client-only — start the file with `"use client"`.
- Never persist Supabase auth state here. That lives in `lib/supabase/`.
- A real store file looks like:

  ```ts
  "use client";
  import { create } from "zustand";

  type State = { draft: string; setDraft: (s: string) => void };

  export const useExampleStore = create<State>((set) => ({
    draft: "",
    setDraft: (draft) => set({ draft }),
  }));
  ```

- A real query file looks like:

  ```ts
  "use client";
  import { useQuery } from "@tanstack/react-query";
  // ...
  ```
