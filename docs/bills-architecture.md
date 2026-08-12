# Bills Architecture

## Module APIs

- `src/lib/bills/model.ts` contains pure calendar, grouping, status, and mixed-currency total projections. It accepts domain records and has no React, Supabase, or translation dependency.
- `src/lib/bills/recurrence.ts` owns the editor recurrence draft, RRULE serialization, and bounded occurrence previews.
- `src/lib/bills/commands.ts` maps UI drafts to typed persistence/RPC values and returns a discriminated validation result. UI components localize validation feedback.
- `src/store/bills.ts` holds only ephemeral sheet identifiers and visibility. Server records stay in TanStack Query.
- `src/hooks/useBills.ts` is the browser-Supabase adapter. It owns RLS-protected reads, writes, and cross-domain cache invalidation.

## Design Boundaries

- Presentation consumes projected data and command results; it does not parse money, serialize recurrence, or implement calendar calculations.
- Domain modules depend on typed inputs and return values, not React or Supabase implementations.
- The hooks form the external persistence boundary, so the domain model can be reused by another UI without data-client coupling.
- State interfaces expose only the sheet actions each feature needs and retain identifiers rather than mutable domain objects.

## Verification

Unit tests cover pure model, recurrence, command, and UI-state modules. Existing hook tests cover browser persistence commands, and database pgTAP tests remain the authority for RLS and atomic payment workflows.
