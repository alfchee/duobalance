# duobalance

Household finance for two — shared balances, transactions, budgets, and bills.

Part of [Phase 0 / epic #1](https://github.com/alfchee/duobalance/issues/1). The current
milestone ends at: "both partners can log in and see the same household."

## Stack

- **Next.js 15** (App Router, client SPA — `'use client'` for every data-touching component)
- **Supabase** (Auth, Postgres, RLS, Realtime)
- **Vercel** (hosting; PR previews on)
- **Tailwind 4** + **shadcn/ui** (new-york style)
- **next-intl** (es default, en; wired in #16)
- **Zod** (env + payload validation)
- **Husky + lint-staged** (pre-commit)

A future **Tauri** desktop build is a constraint, not a current target. The
`BUILD_TARGET=tauri npm run build` command must produce a static `out/` directory —
that's the proof the conventions in this scaffold keep that option viable.

## Architecture (the rules)

1. **All data work happens in `'use client'` components.** No server components fetch data.
   No server actions. No `middleware.ts` for auth.
2. **Route handlers under `app/api/**` are the only server-side surface.** Used for secrets
   and third-party calls. `app/api/health/route.ts` is the smoke test.
3. **`apiFetch` is the only sanctioned way to call the API.** A relative `/api/...` URL
   breaks the moment the frontend is served from `tauri://localhost`, so we always route
   through `lib/api-fetch.ts` and `NEXT_PUBLIC_API_BASE_URL`.
4. **RLS is the primary authorization boundary** (per #1). The client talks to Supabase
   directly for reads and realtime; the service role is route-handler only.
5. **i18n lives in `src/messages/{es,en}.json`.** Wiring lands in #16.

## Local development

```bash
npm install
cp .env.example .env.local        # fill in once #9 lands; not required for #8
npm run dev                       # http://localhost:3000
```

## Build verification

```bash
npm run typecheck                 # tsc --noEmit
npm run lint                      # eslint .  (catches next/headers, 'use server')
npm run format:check              # prettier --check .
npm run build                     # standard Vercel/web build
BUILD_TARGET=tauri npm run build  # static out/ — proves the Tauri constraint holds
```

## Project layout

```
src/
  app/
    (auth)/        login, signup, accept-invite/[token]
    (app)/         balances, transactions, budget, bills, settings
    api/           route handlers only (lib/supabase/server.ts is the only allowed entry)
    layout.tsx     root
    page.tsx       landing
  components/
    ui/            shadcn primitives
    providers.tsx  client provider tree
  lib/
    api-fetch.ts   THE single API helper
    env.ts         Zod-validated env reader
    money.ts       Intl money formatters (CLP, USD, BRL, …)
    supabase/      client.ts (anon), server.ts (service role, route-handler only)
    utils.ts       cn() helper
  store/           Zustand + TanStack Query, one file per domain
  messages/        es.json, en.json (i18n strings; populated by #16)
```

## Database & Supabase

The `db:*` npm scripts are reserved (see `package.json`) and are no-ops until #9
provisions the Supabase CLI. Do not run them before then.

## Vercel

PR previews are automatic. Set the env vars listed in `.env.example` in the Vercel
dashboard. **Do not** set `BUILD_TARGET` — only the Tauri build script does.

## License

All rights reserved. See [LICENSE](LICENSE).
