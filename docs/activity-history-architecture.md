# Activity History Architecture

## Boundaries

- `src/lib/transactions/activity-filters.ts` owns activity URL contracts. It parses search parameters into a narrow immutable filter model, serializes user selections, applies filter deltas, and resolves the history route.
- `src/lib/transactions/activity-model.ts` owns pure financial presentation rules. It calculates Count/Inflow/Outflow, excludes transfers from monetary totals, and groups rows by date with transfer-free daily subtotals.
- `src/lib/transactions/activity-query.ts` owns the query-filter policy. It accepts a minimal filter-operation port so the same predicate rules apply to paged ledger and summary reads without depending on Supabase.
- `src/hooks/useTransactions.ts` is the RLS-bound data-access adapter. It creates the browser Supabase query, adapts it to the filter-operation port, owns cursor pagination and TanStack Query cache lifecycle, and owns mutation persistence.
- `src/store/transactions.ts` holds only entry-sheet state. Server transactions remain in TanStack Query.
- `src/components/transactions/transactions-view.tsx` is the activity controller/view. It composes hooks and pure models, maintains the debounced text-input interaction, renders supplied data, and delegates UI commands.

## Dependency Direction

Activity components depend on the controller hooks, domain contracts, and display helpers. The query adapter depends on the filter-operation abstraction, not on Supabase. The Supabase browser client stays inside the RLS-bound hook.

`ActivityFilters` and `ActivityTransaction` are narrow structural contracts. New query clients or activity surfaces can implement the operation port or consume the pure models without a React or Supabase dependency.

## SOLID Review

- **Single responsibility:** URL policy, activity financial rules, query predicates, persistence, ephemeral UI state, and rendering have independent modules.
- **Open/closed:** additional filters extend `ActivityFilters` and `ActivityFilterOperations`; new activity surfaces reuse model and route functions without changing the ledger component.
- **Liskov substitution:** the model accepts structural `ActivityTransaction`/`DatedActivityTransaction` records, and the query policy accepts any valid `ActivityFilterOperations` implementation.
- **Interface segregation:** `ActivityFilterOperations` contains only individual filtering capabilities; pure models accept only the transaction fields they require.
- **Dependency inversion:** `activity-query.ts` depends on a query-operation port. Components depend on typed hooks and pure contracts, while concrete Supabase behavior is isolated to `useTransactions`.

## Compatibility

- Transaction list and summary queries retain identical date, account, category, member, type, and sanitized text predicates.
- Transfer rows remain in Count but are excluded from Inflow, Outflow, Net, and daily monetary subtotals.
- URL synchronization, 300ms search debounce, cursor pagination, RLS behavior, account-scoped history, and transaction-entry/edit actions are preserved.

## Verification

- Unit tests cover malformed and duplicate URL IDs, account-detail precedence, clear filters, query operation delegation, sanitized search, transfer aggregation, null base amounts, and date grouping.
- `npm run test:coverage` reports V8 coverage for the extracted activity domain modules alongside the existing balance scope.
- `npm run check` and `BUILD_TARGET=tauri npm run build` remain the integration and static-export gates.
