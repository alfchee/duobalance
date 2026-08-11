# Activity History Refactor Audit

## Assessment Scope

The audit covered the transaction activity page, its query hook, transaction UI store, entry points, and focused UI tests.

## Pre-Refactoring Findings

| Priority | Risk                  | Finding                                                                          | Resolution                                                                                                 |
| -------- | --------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| High     | Behavioral drift      | Paginated and summary reads duplicated every transaction filter predicate.       | Centralized filter policy in `activity-query.ts` and applied it through a narrow query-operation port.     |
| Medium   | Financial correctness | The activity component calculated transfer exclusion and daily subtotals inline. | Moved financial presentation rules to `activity-model.ts` with direct tests.                               |
| Medium   | Coupling              | The activity component parsed/serialized URL parameters and selected its route.  | Moved URL contract behavior to `activity-filters.ts` with direct tests.                                    |
| Medium   | Testability           | Finance and URL policies required rendering the full component to test.          | Added pure-module test suites and retained component tests for user interactions.                          |
| Low      | Extensibility         | Data filtering depended directly on Supabase chain calls.                        | Introduced `ActivityFilterOperations`, allowing alternative query adapters without altering filter policy. |

## Post-Refactoring Result

- The activity component no longer contains URL parsing, query-predicate policy, summary reduction, or day-subtotal logic.
- The query hook is the only concrete Supabase adapter for activity reads and remains client-side/RLS-bound.
- Business policies have pure tests and structural TypeScript contracts, reducing dependence on the UI runtime.
- The architecture adheres to the project client-SPA, direct-RLS, TanStack Query, and static-export constraints.

## Residual Technical Debt

- The summary query still retrieves every matching transaction to calculate aggregate values in the browser. A future performance-focused issue should introduce an RLS-safe database aggregate endpoint or security-invoker view; it is intentionally out of this refactor because it changes the data contract and needs migration/pgTAP work.
- The transaction entry sheet remains a separate, large feature boundary. Its form-command extraction should be a dedicated follow-up to avoid coupling it to this no-behavior-change activity refactor.

## Test Coverage Scope

The coverage report includes the three extracted activity domain modules. It is a scoped feature-quality measure; it does not claim repository-wide 90% coverage, which would include unrelated existing features outside this refactor.
