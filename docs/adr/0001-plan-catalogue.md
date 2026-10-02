# ADR 0001 — Plan catalogue and free-tier contents

- Status: Accepted (2026-09-23)
- Decides: #256 (closes it)
- Parent epic: #255 (Phase A: SaaS layer, provider-independent)
- Informed by: `reports/metrics/2026-09-22.md`

## Context

Nothing in Phase A can be seeded or gated until the plans exist as a
decision. The 2026-09-22 metrics show only **2 of 18 active households**
ever had a partner join (4 ever sent an invitation). That figure cut both
ways and was weighed explicitly: it argues partner sharing is a weak paid
wedge (a door almost nobody reaches), but it also means giving it away
free costs nothing in differentiation while removing what makes
DuoBalance different from a personal finance app. The decision below
gates partner sharing on paid anyway, for one reason: with history,
accounts, households, and export also metered, the catalogue needs a
single headline distinction between "solo tracking" (free) and "the
couple's shared finances" (paid). If post-launch data shows the partner
invite becoming a conversion driver rather than a blocker, this ADR gets
revisited — see Review trigger.

## Decision

Two plans. One paid tier with two billing intervals. No second paid tier
until a real wedge for it exists.

### `free` — "Duo"

Display name in all locales: **Duo** (es/en/pt-BR identical; no
translation needed).

| Feature / limit               | Free                                   |
| ----------------------------- | -------------------------------------- |
| Members                       | 1 — owner only, **no partner sharing** |
| Households                    | 1                                      |
| Accounts (non-archived)       | 4                                      |
| Visible transaction history   | 1 year                                 |
| Budgets                       | Included, unlimited                    |
| Bill reminders                | Included                               |
| Export (`/api/export`, CSV)   | Not included                           |
| Long-range reports (> 1 year) | Not included                           |

### `plus` — "Plus"

Display name in all locales: **Plus**.

| Feature / limit             | Plus                                              |
| --------------------------- | ------------------------------------------------- |
| Members                     | Up to 3 active (owner + partner + one extra seat) |
| Households                  | Up to 3                                           |
| Accounts                    | Unlimited                                         |
| Visible transaction history | Unlimited                                         |
| Budgets / reminders         | Included, unlimited                               |
| Export                      | Included                                          |
| Long-range reports          | Included                                          |

Billing intervals on `plus`: **monthly** and **annual**.
Fixed prices in NIO (BAC settles córdobas — no charge-time FX conversion,
no variable amounts on bank statements):

| Interval | NIO (fixed)        | USD reference |
| -------- | ------------------ | ------------- |
| Monthly  | **C$129 / month**  | $3.50         |
| Annual   | **C$1,290 / year** | $35.00        |

FX reference: 36.80 NIO/USD mid-market, September 2026
($3.50 × 36.80 = C$128.80 → C$129; $35 × 36.80 = C$1,288 → C$1,290).
Annual = 10× monthly: **12 months for the price of 10** (2 months free).

### Trial policy

- 1-month free trial of `plus`, **no card required**.
- On expiry without payment: automatic downgrade to `free`. No auto-charge,
  ever — especially while local acquiring is still in discovery.
- Downgrade never deletes data. Anything over free limits becomes
  read-only until the household is back within limits (archive an account,
  not delete history).

### Enforcement principles (for the schema seed)

- History limits are **view-only**. Data is never deleted or hidden by
  retention jobs; queries simply scope to the visible window.
- Member limits count **active** memberships only (removed members don't
  consume seats).
- Downgrade path must always resolve to readable free state without data
  loss — this is a correctness requirement, not UX polish.

## Consequences

- The plans/entitlements seed reads plan codes `free` / `plus` and the
  limits above; codes are stable, display names are locale data.
- Billing stays behind the Phase A exposure flag (epic #255): these
  decisions change no user-visible behavior until the flag turns on.
- Gateway fee analysis (fixed per-transaction fee vs. price point) stays
  with the BAC/aggregator discovery. At ~C$129/mo the fee ratio is far
  healthier than at the earlier C$75 point, which is part of what makes
  this price defensible.
- The 2-of-18 partner figure is now the pre-decision baseline: if paid
  partner sharing suppresses invites further, the funnel will show it and
  this ADR gets amended, not silently worked around.

## Review trigger

Revisit this ADR if, post-launch: partner-invite rate drops vs. the
pre-launch baseline with paid sharing cited as the reason; or the 1-year
free history window demonstrably costs conversions rather than earning
them. Either re-opens #256's partner/history questions with real data.
