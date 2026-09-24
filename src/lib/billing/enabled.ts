// BILLING_ENABLED flag and production gating (issue #262, epic #255).
//
// SINGLE ACCESSOR: `isBillingEnabled()` below is the ONLY place in `src/`
// allowed to read `BILLING_ENABLED` / `NEXT_PUBLIC_BILLING_ENABLED` from
// `process.env`. Every checkout entry point, the webhook route, UI plan
// gating and admin billing screens gate through it — never through a
// scattered `process.env` read. Locked by `enabled.test.ts` (text scan) and
// the CI grep guard in `.github/workflows/ci.yml`.
//
// TWO NAMES, ONE FLAG: the server reads `BILLING_ENABLED`; the browser
// bundle cannot see it, so the client mirrors it as
// `NEXT_PUBLIC_BILLING_ENABLED`. The accessor gives the server var
// precedence when it is set and falls back to the public mirror otherwise,
// so one call site works on both sides: in the browser the server var is
// always unset and the mirror decides; on the server an explicit value
// (including an explicit off) wins over a stale mirror. Both default to
// OFF — unset, empty, or any unrecognised value means "billing is not live".
//
// FAIL-OPEN WHILE OFF: while the flag is off, entitlements evaluate as if
// everyone is entitled (`shouldBypassPlanGating()` / `effectiveEntitlement()`
// below). This is deliberate: with no payment provider connected there is no
// revenue to protect, and hiding a feature from a paying user is a worse
// failure than showing one to a free user. See epic #255.

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** Parse one raw env value. Exported for tests; consumers call `isBillingEnabled()`. */
export function parseBillingEnabledFlag(value: string | undefined): boolean {
  if (!value) return false;
  return TRUTHY.has(value.trim().toLowerCase());
}

/**
 * The single typed accessor for the billing exposure flag (issue #262).
 * Server `BILLING_ENABLED` takes precedence when set (an explicit off beats
 * a stale mirror); otherwise the `NEXT_PUBLIC_BILLING_ENABLED` mirror
 * decides (this is the browser path — the server var is never inlined
 * there). Defaults to `false`.
 */
export function isBillingEnabled(): boolean {
  const server = process.env.BILLING_ENABLED;
  if (server !== undefined && server !== "") {
    return parseBillingEnabledFlag(server);
  }
  return parseBillingEnabledFlag(process.env.NEXT_PUBLIC_BILLING_ENABLED);
}

/**
 * True while billing is NOT live — UI plan gating (#264) and entitlement
 * checks must treat everyone as entitled. Fail open, deliberately.
 */
export function shouldBypassPlanGating(): boolean {
  return !isBillingEnabled();
}

/**
 * Apply the fail-open rule: with the flag off the real entitlement value is
 * ignored and `true` is returned. With the flag on the value passes through.
 */
export function effectiveEntitlement(entitled: boolean): boolean {
  if (shouldBypassPlanGating()) return true;
  return entitled;
}
