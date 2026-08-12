# Balances Architecture

## Boundaries

- `src/lib/accounts.ts` contains account-domain rules: balance display semantics, debt presentation, account ordering, and constraint-error recognition.
- `src/lib/balances.ts` contains reusable balance utilities: tab selection, account grouping, FX conversion, totals, currency breakdowns, and freshness calculations.
- `src/lib/balance-screen.ts` composes the account and balance domains into a screen model. It exposes `createBalanceScreenModel`, `createRatesByCode`, and `prepareBalanceReorder`; it has no React, browser, or Supabase dependency.
- `src/hooks/useAccounts.ts` is the RLS-respecting client data-access boundary for `accounts` and `account_balances` queries and mutations.
- `src/hooks/useFxOverrides.ts` is the FX data-access boundary. It resolves household overrides over the latest feed.
- `src/hooks/useBalancesScreen.ts` is the screen controller. It combines query results with the pure screen model and delegates reorder persistence to the account mutation abstraction.
- `src/store/balances.ts` holds only persisted presentation state for the selected tab. Server data remains in TanStack Query.
- `src/components/accounts/balances/` renders the model and delegates all data access and rules to typed props and hooks.

## Usage

Use `useBalancesScreen()` from the balance route component. It returns loading/error state, derived screen data, retry behavior, and the reorder command. Do not query Supabase, calculate totals, resolve FX rates, or reimplement ordering inside a balance component.

Use `createBalanceScreenModel()` in non-React consumers and tests that need balances, grouped rows, subtotals, breakdowns, or net worth. Pass `RatesByCode` produced by `createRatesByCode()` from effective rate records.

Use `prepareBalanceReorder()` for any future UI interaction that changes account ordering. It maintains the RLS-aligned invariant that partner-owned shared accounts remain locked.

## SOLID Review

- **Single responsibility:** data access, pure domain calculation, screen orchestration, state persistence, and rendering are separate modules.
- **Open/closed:** section, filter, and rate behavior are exposed through typed domain APIs; new consumers extend behavior by composing models rather than modifying components.
- **Liskov substitution:** `AccountWithBalance` is preserved through generic reorder operations, and all UI boundaries accept narrow structural contracts.
- **Interface segregation:** screen components receive only their required values, such as a subtotal, breakdown, or reorder callback, rather than query clients or Supabase instances.
- **Dependency inversion:** components depend on `useBalancesScreen` and typed data contracts; the controller depends on query hooks and pure abstractions, while Supabase remains confined to service hooks.

## Verification

- `npm run test:coverage` reports scoped coverage for balance domain and UI-state modules.
- `npm run check` remains the repository quality gate.
- `BUILD_TARGET=tauri npm run build` validates static-export compatibility.
