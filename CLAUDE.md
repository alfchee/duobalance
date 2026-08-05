# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

duobalance — household finance for two partners. Definition of done (per epic #1) is "both partners can log in and see the same household on a deployed URL." Phase 0 (issues #8, #9) is the scaffold; feature work starts in #10+.

For project context the user maintains a persistent memory at `~/.claude/projects/-home-alfchee-Workspace-own-duobalance/memory/`. The most relevant files there are `project_duobalance.md` and `architecture-conventions.md` — read both before suggesting architectural changes.

## Hard architectural rules

These are not aspirational — they are enforced by ESLint, grep guards in CI, and the `BUILD_TARGET=tauri` smoke test. Don't propose changes that violate them.

1. **Client SPA.** Every data-touching component is `'use client'`. No server components fetch data. No server actions. No `middleware.ts`. `lib/supabase/client.ts` (anon) is the only Supabase entry for the browser.

2. **Route handlers under `app/api/**` are the only server-side surface.** They are where `lib/supabase/server.ts` (service role) and third-party secrets live. ESLint flat config (`eslint.config.mjs`) bans `next/headers` and `'use server'` from everywhere else.

3. **`apiFetch` is the only way to call the API.** See `src/lib/api-fetch.ts`. Relative `/api/...` URLs break under `tauri://localhost`; routing through `NEXT_PUBLIC_API_BASE_URL` is mandatory. There is a CI guard against `fetch('/api/...` in `src/`.

4. **RLS is the primary authorization boundary.** Direct PostgREST access is fine for the client; the service role is for trusted server code only. Every new table must have RLS policies in its migration + pgTAP coverage in `supabase/tests/`.

5. **Static-export-safe.** `BUILD_TARGET=tauri npm run build` must succeed and produce `out/`. This means: no `force-dynamic` routes, every dynamic route needs `generateStaticParams`, every route handler that runs under export needs `export const dynamic = 'force-static'`. See `app/api/health/route.ts` for the pattern.

## Component & React conventions

The stack is React 19.1 on Next 15.5 App Router, with a strict client-SPA posture. Generic React advice doesn't apply here — the architecture is what it is. What follows is what _this_ codebase specifically requires.

**Component authoring**

- `'use client'` is the first line of every file in `src/components/` and every file under `src/app/` that touches data, state, hooks, or browser APIs. Even pure presentational components that could be server components live as client components in this repo — it keeps the mental model uniform and the future split easier.
- Named exports only. No `export default` for components. The eslint config will complain about anonymous function components.
- shadcn primitives go in `src/components/ui/`, copied verbatim from the registry. Do not fork them. Compose them in feature components elsewhere under `src/components/`.
- Feature components are colocated next to the page that uses them _only_ when truly page-specific. Cross-page components go in `src/components/<domain>/`.
- Hooks go in `src/hooks/`, one file per hook (`useBalances.ts`, `useTransactions.ts`, …). Hooks are client-side; start the file with `'use client'`.

**State management** (see `src/store/README.md` for the full pattern)

- **TanStack Query** for anything backed by the server — accounts, transactions, balances, etc. Query keys mirror the domain (`['transactions', householdId, filters]`).
- **Zustand** for ephemeral UI state — modal open/closed, draft forms, filter panels. One store per domain file (`accounts.ts`, `transactions.ts`). Do not put server data in Zustand.
- React 19's `useOptimistic` and the new `<form action>` patterns are preferred for mutation flows that need immediate UI feedback. The existing forms in `(auth)/` and `(app)/` will be retrofitted; new forms should use them from the start.

**Styling**

- Tailwind 4 with CSS-first config in `src/app/globals.css`. There is no `tailwind.config.ts`; the design tokens live in the `@theme` block. Do not create one.
- Use the `cn()` helper from `src/lib/utils.ts` for conditional class names. Never concatenate class strings manually.
- shadcn/ui (new-york style) is the component library. Do not add MUI, Chakra, Mantine, or other UI kits. Run `npx shadcn@latest add <component>` to add primitives.
- For negative numbers, use the U+2212 MINUS SIGN (`−`), not the hyphen-minus (`-`). The `formatSignedMoney` helper in `src/lib/money.ts` does this; use it.

**Type safety**

- `tsconfig.json` has `noUncheckedIndexedAccess: true`. Array index access returns `T | undefined`. Don't disable this; write code that handles the undefined case.
- Use the `@/*` path alias for imports from `src/`. No deep relative paths like `../../lib/...`.
- Domain types live in `src/lib/supabase/types.ts` (generated). For hand-written types, prefer Zod schemas and infer with `z.infer<typeof schema>` over manual interfaces — `env.ts` is the model.

**Data fetching**

- For Supabase data the client reads: `createSupabaseBrowser()` from `lib/supabase/client.ts`. Never `new createClient(...)` in a component.
- For backend APIs (route handlers, third-party calls): `apiFetch()` from `lib/api-fetch.ts`. The helper handles 204s, JSON, errors, and the `NEXT_PUBLIC_API_BASE_URL` prefix.
- React Query mutations call Supabase directly (anon key + RLS). The service-role path is for route handlers only.

**Money**

- Always go through `src/lib/money.ts`. `formatMoney(1234, "CLP", "es")` → `$1.234`. The minor-unit count (CLP=0, USD=2) is in the `currencies` table — never derive decimals from `Intl` for input parsing.
- For keypad input, use `roundToMinorUnit(amount, currencies.minor_unit)` before persisting.

**Error & loading states**

- `app/error.tsx` and `app/loading.tsx` are the app-level boundaries. Add page-level `<Suspense>` and error boundaries around data-heavy sections rather than each leaf.
- `ApiError` (from `api-fetch.ts`) has a `status` and `body`; treat 4xx as user-fixable and 5xx as system errors. Show a `<Skeleton>` for pending, a Card with retry for errors.

## Build & test commands

```bash
npm run dev                       # http://localhost:3000
npm run check                     # typecheck + lint + format:check (the gate)
npm run build                     # web build (Vercel)
BUILD_TARGET=tauri npm run build  # static-export smoke test — must succeed
```

Database (`db:*` scripts, after `supabase` CLI is installed):

```bash
npm run db:start                  # boots local stack on 55321/55322/...
npm run db:reset                  # drops + re-applies all migrations + seed
npm run db:types                  # regenerates src/lib/supabase/types.ts
npm run db:test                   # pg_prove against supabase/tests/[0-9]*.sql
npm run db:new <name>             # creates supabase/migrations/<ts>_<name>.sql
npm run db:push                   # cloud only — apply local migrations to remote
```

## Migration discipline

- Migrations live in `supabase/migrations/`, named `<YYYYMMDDHHMMSS>_<topic>.sql`.
- **Forward-only.** Never edit a migration that has been applied. Add a new one.
- The 11 existing migrations are in dependency order (currencies → households → … → helpers+RLS). When adding a table that references another, place the new migration after the one it depends on.
- Every migration that creates a household-scoped table must also include the matching RLS policy using the `public.is_member(household_id)` helper from migration 11.
- New behavior that needs cross-table logic goes in migration 11 (or a new migration after it), not in earlier files.
- Add a pgTAP test in `supabase/tests/` for every new RLS policy. The existing 4 files (reference tables, tenant isolation, member management, anon denied) are the patterns to follow.

## Conventions worth knowing

- **Local Supabase ports are 55321/55322/55323/55324/55327**, not the defaults. This is to coexist with another local Supabase project on the host. CI uses the same ports for consistency. If you see a port conflict, don't change the config — confirm `npx supabase status` first.
- **`db:types` uses `--db-url`, not `--local`.** The CLI's `--local` flag resolves to a Docker-internal hostname (`db:5432`) that doesn't exist for the shifted-port container; `--db-url postgresql://postgres:postgres@127.0.0.1:55322/postgres` is the working form. The script also prepends `/* eslint-disable */` to the generated file because the packed-one-line output trips the linter.
- **Generated `src/lib/supabase/types.ts`** is auto-generated. Don't hand-edit; regenerate. It is excluded from eslint and prettier via `eslint.config.mjs` and `.prettierignore`.
- **Service-role-key leak guard** lives in `.github/workflows/ci.yml` as two steps: a source grep (`src/`) and a bundle grep (`.next/static/`). Both must pass. If you need to add a file that legitimately references the key, it must live under `app/api/**` or in `lib/supabase/server.ts` — the guard's allowlist is the source of truth.
- **`'use client'` at the top of every component file** under `src/components/` and `src/app/`. Even if a file doesn't currently use hooks, the directive keeps it portable to components that do.

## When adding a new feature

1. Read `project_duobalance.md` in the user's memory to understand the broader context.
2. Check whether the issue you're working on is part of an epic with acceptance criteria; quote the AC in the commit message.
3. New table → migration in dependency order + RLS policy + pgTAP test.
4. New env var → add to `.env.example` with the correct scope (client `NEXT_PUBLIC_*` or server-only).
5. New env reader field → update the Zod schema in `src/lib/env.ts`.
6. New client data fetch → use `createSupabaseBrowser()` from `lib/supabase/client.ts`, never instantiate a new client.
7. New server-side secret → use `createSupabaseRouteHandler()` from `lib/supabase/server.ts`, only inside `app/api/**`.
8. Run `npm run check` and `npm run db:test` before committing. If you touched `supabase/migrations/`, also run `npm run db:reset && npm run db:types` and commit the regenerated types.
