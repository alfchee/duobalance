# Data export & account deletion — transaction-retention rule (#269)

Parent epic: #255 (Phase A: SaaS layer, provider-independent).

This document is the decision the issue notes call out as hard to change
afterwards: **what survives a departure versus what survives an account
deletion**. The code implements exactly what is described here; the pgTAP
suite (`supabase/tests/34_data_export_account_deletion.sql`) pins it.

## Rule in one paragraph

**Transactions are never mutated by a departure or a deletion.** A member
leaving (voluntary `leave_household` or owner-driven `remove_member`),
a household being soft-deleted, or an account being deleted never edits,
reassigns, or deletes a row in `transactions`. Balances are computed from
the ledger, so balances cannot break: no orphaned rows, no rewritten
history. What changes is only the _membership_ row and its personal
identifiers. Hard-deleting a membership row that transactions still
reference is blocked at the database level (`entered_by` /
`spent_by … ON DELETE RESTRICT`), so the "delete" path is
anonymize + soft-remove, never a cascading row delete.

## Departing member (leave vs remove)

Both paths end in the same state: the membership row gets
`removed_at = now()` (plus `removal_reason` `left`/`removed` and
`removed_by`), and the row is immediately invisible to every RLS policy
because all helpers read through `active_membership`.

| Aspect                                 | `leave_household` (voluntary)                                                                            | `remove_member` (owner-driven)                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who can call                           | the member themselves                                                                                    | an active owner, never self                                                                                                                               |
| Owner guard                            | owners cannot leave while others remain (transfer first); last member leaving soft-deletes the household | owners cannot be removed; ownership must be transferred first                                                                                             |
| Shared accounts owned by the departed  | n/a (own accounts stay)                                                                                  | caller must pass a per-account disposition: `transfer` (to caller) or `joint` (owner → null); anything unresolved aborts with `unresolved owned accounts` |
| Private accounts owned by the departed | stay owned by the departed row                                                                           | stay owned by the departed row                                                                                                                            |
| Bills assigned to the departed         | stay (leave path)                                                                                        | reassigned to the caller                                                                                                                                  |
| Transactions (`entered_by`/`spent_by`) | untouched                                                                                                | untouched                                                                                                                                                 |
| `display_name`                         | retained (history still shows who entered what)                                                          | retained                                                                                                                                                  |
| Export after removal                   | cutoff to `removed_at` (+ household `deleted_at` if earlier), scoped to shared + own-private accounts    | same                                                                                                                                                      |

Private accounts of a departed member remain in the household but are
invisible to the remaining members (RLS: private readable only by its
owner). They are excluded from household totals for everyone else, and
the departed member can still export them through the removed-member
export fallback until the household itself is purged.

## Deleted account (auth user)

Account deletion is a superset of departure, with one extra step:
**anonymization**. The flow is request → explicit confirmation (typed
email must match) → 30-day grace (cancellable) → purge:

1. `pending` — request recorded, nothing changes.
2. `confirmed` — confirmation recorded, `scheduled_purge_at =
confirmed_at + 30 days`. The user can still cancel; data is untouched.
3. `purged` — the cron job (`POST /api/cron/purge-accounts`, bearer
   secret, service role) calls the atomic `purge_account_deletion()`
   RPC, which anonymizes every membership of that user — including
   already-removed rows, whose display name is still personal data —
   appends one audit row per household, and marks the request purged in
   a single transaction (a retry can never half-apply or duplicate audit
   rows): `display_name → 'Deleted member'`; active rows are additionally
   soft-removed (`removed_at`, `removal_reason = 'left'`).
   Transactions keep pointing at the same membership ids, so the
   household's books still balance. One row per affected household is
   appended to `deletion_audit_log` containing only ids, event type, and
   timestamps — never email, display name, amounts, descriptions, or
   notes. The same cron run sweeps expired export links (no PII, no
   audit row needed).

Membership rows are **never hard-deleted** while transactions reference
them; the `ON DELETE RESTRICT` FKs make a cascade fail loudly instead
of silently orphaning the ledger. The purge therefore ends at
anonymization: the `auth.users` identity itself is removed out-of-band
(and only once no ledger row blocks it), never by the purge job — after
`purged`, no personal identifier remains in application tables either
way.

The state machine is enforced twice: the `enforce_deletion_transition`
trigger restricts rows to `pending → confirmed → purged` (either →
`cancelled`) with anti-backdating bounds (`confirmed_at` ≈ now,
`scheduled_purge_at` within 31 days), so direct PostgREST writes cannot
skip the confirmation or shrink the grace period; RLS additionally bars
clients from writing `status = 'purged'` at all — only the purge RPC
(service role, RLS-bypassing owner) may.

## Household deletion

`delete_household` (owner only) sets `households.deleted_at = now()`,
which immediately revokes every member via `active_membership`. Data is
recoverable for 30 days, then `runPurgeHouseholds` hard-deletes the
household row (cascading to all child tables) behind a sanity cap.
Leaving as the last active member delegates to the same path.

## Export links

Self-service export stays household-scoped (`household_id` equality +
active-membership check on every request — a member of A asking for B
gets 403). The time-limited path adds:

- `POST /api/exports` creates a `data_export_links` row with a
  256-bit token (`encode(gen_random_bytes(32), 'hex')`, unguessable,
  hex-shape enforced by CHECK), `format` json/csv. The 24h TTL is
  stamped server-side by trigger (`force_export_link_ttl`), so even
  direct writes cannot mint long-lived links.
- `GET /api/exports/[token]` resolves the token via the service role
  (RLS would otherwise downgrade cross-household callers to a bare
  404), then enforces membership (403) before expiry (410), and serves
  the link's minted format only (a disagreeing `?format` gets 400).
  The plan check is intentionally not repeated at redemption: the mint
  already enforced `has_feature('export')`, and a 24h link survives a
  mid-day plan change the way a downloaded file would.
- Tokens are bearer secrets but never a substitute for membership: a
  valid token for household A presented by a non-member still gets 403.
- Removed members keep the direct-export fallback (cutoff + account
  scoping) but cannot mint new links.

## Audit without content

`deletion_audit_log` is append-only (service role inserts; members may
read their own household's rows; nobody updates or deletes). Columns
are `id, occurred_at, household_id, event_type, actor_member_id,
target_member_id`. There is deliberately no email, name, amount, or
free-text column — an audit row proves _that_ a deletion happened,
_when_, _in which household_, and _which stub rows_ it touched, without
retaining any deleted personal data.
