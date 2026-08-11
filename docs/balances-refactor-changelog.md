# Balances Refactor Changelog

## Structural Changes

- Added `src/lib/balance-screen.ts` as the pure balance-screen domain facade.
- Added `src/hooks/useBalancesScreen.ts` as the sole balance-screen controller for query composition, screen state, retry, and reorder delegation.
- Simplified `BalancesView` to render controller state and issue UI commands only.
- Moved net-worth, section subtotal, currency breakdown, rate-map, ownership filtering, and reorder adaptation out of balance page components.
- Updated header and section contracts to receive calculated values rather than calculate them.
- Hardened the Mine filter to return no records until an active member is known.

## Quality Changes

- Added targeted balance screen-domain and persisted-tab store tests.
- Added V8 coverage reporting through `npm run test:coverage` for scoped balance domain and state modules.
- Added a 95% quality threshold for scoped statements, functions, and lines.
- Excluded generated coverage reports from ESLint analysis.

## Compatibility

- Preserved direct browser Supabase access through existing RLS-bound hooks.
- Preserved shared TanStack Query account keys and mutation invalidation behavior.
- Preserved static export compatibility and existing account, transaction, FX, and realtime contracts.
