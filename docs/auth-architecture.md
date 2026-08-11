# Authentication Architecture

## Boundaries

Authentication and household components render translated UI, collect user input, display pending/error state, and navigate after a successful workflow. They do not call Supabase Auth or household RPCs directly.

`src/lib/auth/flows.ts` contains framework-independent authentication rules and typed ports. It owns input normalization, password strength, error-result contracts, neutral password-reset behavior, and post-auth destination resolution.

`src/lib/household/workflows.ts` contains framework-independent household rules and typed ports. It owns household input normalization, invite error mapping, and active-household persistence.

`src/hooks/useAuthCommands.ts` and `src/hooks/useHouseholdCommands.ts` adapt those ports to the browser Supabase client. The household hook also owns membership-query invalidation, while active-household persistence is centralized in the household workflow module.

## Dependency Direction

UI components depend on hooks and typed workflow results. Hooks depend on domain workflows. Domain workflows depend only on small injected ports and pure helpers. Supabase is therefore isolated at the client adapter boundary.

## Testing

Pure workflow tests exercise domain rules with injected ports. Hook and component tests should mock the Supabase client or workflow hook at their boundary and assert visible state and navigation only. This keeps transport, security, and UI regressions independently diagnosable.
