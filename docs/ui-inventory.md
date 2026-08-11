# duobalance — Current UI Inventory

**Purpose of this document:** a complete, concrete inventory of every screen, form, navigation element, and feature in the current duobalance app, as it exists today. This is a redesign brief input — hand it to a design tool (OpenDesign, ClaudeDesign, Figma, etc.) or a designer so the *behavior and information* of the app is preserved while the *visual design* is reimagined. It intentionally does not prescribe visuals; it documents what exists so nothing gets silently dropped in a redesign.

**App summary:** duobalance is household finance for two partners — shared accounts, transactions, budgets, and bills, viewable and editable by both members of a household, with private ("mine-only") accounts also supported. It's a mobile-first Progressive Web App (installable, works in a Tauri desktop shell) built as a client-side SPA on Next.js App Router.

**Cross-cutting observations for the redesigner** (see [Design Opportunities](#design-opportunities-for-a-redesign) at the end for the full list):
- There is currently **no persistent visual identity** — no logo, wordmark, header, or brand color system beyond shadcn defaults. Every auth/onboarding screen is a single centered `Card` on a blank background.
- The only permanent navigation chrome in the whole app is a 5-item bottom tab bar plus one floating action button.
- Money formatting, negative-number display (using the proper U+2212 minus sign), and locale-aware decimal parsing are consistent app-wide and should be preserved as functional requirements, not just visual details.
- Several screens carry meaningful state signaling (staleness of manual balances, overdue bills, over-budget categories, FX rate source transparency) that should stay visually prominent in any redesign — these are trust/accuracy signals central to the product's value.

---

## Table of Contents

1. [Auth Flow](#auth-flow)
2. [App Shell / Navigation](#app-shell--navigation)
3. [Balances & Accounts](#balances--accounts)
4. [Transactions](#transactions)
5. [Bills](#bills)
6. [Budget](#budget)
7. [Settings](#settings)
8. [Global States & Landing Page](#global-states--landing-page)
9. [Design Opportunities for a Redesign](#design-opportunities-for-a-redesign)

---

## Auth Flow

All auth screens share `src/app/(auth)/layout.tsx`: a centered single-column `<main>` (max-width `md`, full viewport height, padded) wrapping a single shadcn `Card`. No header, logo, or branding element currently exists — just the card. All copy is internationalized (`next-intl`), supporting Spanish and English.

### Login — `/login`
- **Purpose:** authenticate a returning user.
- **Fields:** `email` (type=email, required), `password` (type=password, required).
- **Actions:** Submit button (label swaps to "Submitting…" while pending), built on React 19 `useActionState` + `<form action>`.
- **Errors:** inline `role="alert"` red text below the fields, mapped from Supabase auth errors to friendly copy.
- **Links:** "Forgot password?" → `/forgot-password`; "No account? Sign up" → `/signup`.
- **Redirect logic:** if a session already exists on mount, redirects immediately to a pending invite (if the user arrived via an invite link, tracked in `sessionStorage`) or to `/balances`. Same redirect fires after a successful login.

### Signup — `/signup`
Multi-step, client-state-driven (no route change), reusing one `Card`:

1. **Step "credentials"** (default):
   - Fields: `displayName` (required), `email` (type=email, required), `password` (type=password, required, min 6 chars).
   - Live password-strength hint under the password field (weak / fair / strong).
   - Submit: "Continue" / "Submitting…".
   - Footer: "Already have an account? Log in" → `/login`.
   - Identical UI shown whether the email is new or already registered, to avoid account enumeration.
   - On success: advances to "household" step (or resumes a pending invite) if a session is returned immediately, otherwise to "check-email".

2. **Step "household"** (shown when no pending invite):
   - Fields: `householdName` (text, required), `country` (Select, required — populated via `Intl.DisplayNames`), `baseCurrency` (Select, required, options shown as "`CODE — Name`").
   - Submit: "Create household" / "Creating…" — creates the household and redirects to `/balances`.

3. **Step "check-email"** (email confirmation required):
   - Title/body message only, plus a "Log in" link. No form.

### Forgot Password — `/forgot-password`
- **Field:** `email` (type=email, required).
- **Action:** Submit → "Submitting…" while pending.
- **Neutral response:** the success screen is shown regardless of whether the email exists (prevents account enumeration).
- **Success state:** replaces the form with a "check your email" message + "Back to login" link.
- **Link:** "Back to login" → `/login` (also present pre-submit).

### Reset Password — `/reset-password`
- Reached via an emailed recovery link (`?code=` PKCE param). If the recovery session or code is missing, shows an **"invalid/expired link"** card with a "Request new link" button → `/forgot-password`.
- **Fields:** `password` (required, min 6), `confirmPassword` (required, min 6).
- **Client-side validation:** passwords must match (inline error, no backend round-trip needed to catch this).
- **Submit:** "Submit" / "Submitting…" — updates the password, then signs the user out (forces fresh login).
- **Success state:** card swaps to "Password updated" with a "Go to login" button.

### Accept Invite — `/accept-invite/[token]`
Reached via an emailed invite link (client-side navigation; the token is never put in the URL for storage, only read once and stashed in `sessionStorage`). States:
- **Loading session:** full-page spinner.
- **Not authenticated:** card "You need an account" with two buttons: "Sign up" and "Log in" (outlined) — both preserve the pending invite so it resumes after auth.
- **Authenticated, accepting:** card showing "Accepting your invite…".
- **Authenticated, error:** red alert text for: expired, already accepted, email mismatch, invalid token, or generic failure.
- **Success:** immediately redirects to `/balances` (household set as active) — no distinct success screen is visible in practice.
- Fully automatic once authenticated; no form to fill in.

---

## App Shell / Navigation

### Root layout gate — `src/app/(app)/layout.tsx`
A client-side auth/household guard wraps every authenticated route (`/balances`, `/transactions`, `/budget`, `/bills`, `/settings/*`). Sequential full-screen checks:
1. Session loading/absent → full-page spinner, then redirect to `/login` if truly unauthenticated.
2. Household membership loading → full-page spinner.
3. User belongs to 2+ households, none selected yet → **Household Picker**.
4. User has zero households → **Household Onboarding**.
5. Otherwise → renders the real app: content wrapped in a realtime-connection-status indicator, bottom padding reserved for the nav bar, a global transaction-entry sheet mounted (so "add transaction" works from any tab), and the bottom nav itself.

### Bottom Navigation
Fixed bottom bar, 5 equal-width tab items + one floating action button:
- **Balances** (wallet icon) → `/balances`
- **Transactions** (left-right arrows icon) → `/transactions`
- **Budget** (pie chart icon) → `/budget`
- **Bills** (receipt icon) → `/bills`
- **More** (••• icon) → `/settings`
- Active tab highlighted in the primary color; detected by exact or prefix path match.
- **Floating "+" button**: circular primary-color button, positioned above-right of the nav bar, opens the global "new transaction" sheet directly (no navigation) from anywhere in the app.
- Respects the iOS safe-area inset at the bottom (PWA/mobile-first).

### Household Picker
Shown when a user has multiple households and none is active yet. Centered card: title/subtitle, then one full-width outlined button per household (name + "Select" affordance). Selecting persists the choice locally.

### Household Onboarding
Shown when a user has no household at all. Centered card with a 2-tab control:
- **Tab "Create"**: fields `displayName`, `householdName` (both required text), `country` (Select), `baseCurrency` (Select). Client-side required-field validation with specific error messages per field. Submit: "Create household" / "Creating…", then redirects to `/balances`.
- **Tab "Invite"**: single field `inviteToken` (required text) + "Accept invite" / "Accepting…" submit. Same error taxonomy as the Accept Invite page (expired / already accepted / email mismatch / invalid token / generic).

---

## Balances & Accounts

**Route:** `/balances` — the app's primary "home" screen (read-mostly, Honeydue-style net-worth overview).

### Header
- Two overlapping circular member avatars (initials, colored per member; partner shown with a subtle ring, or a placeholder if they haven't joined yet).
- Account count text ("N accounts").
- Large tappable **Net worth** card: label + big amount in the household's base currency (red if negative). A chevron/"see breakdown" affordance appears when more than one currency is in play.
  - Tapping opens a **currency breakdown popover**: total, then a line per currency showing the FX rate used, its source ("override" vs "feed"), the native amount, and the converted amount, plus the date the base rate was fetched.

### Tabs
Segmented control: **Mine / All / Joint** — filters which accounts are shown. Selection persists across navigation (not just per-visit).

### Sections
Grouped by account category, in fixed order — **Cash, Credit, Savings, Loans** — each shown only if non-empty. Section header: uppercase label + right-aligned subtotal (red if negative).

### Account row
Per account: kind icon, account name (tap → jumps to that account's filtered transaction list), an owner badge (partner's color for private accounts, outlined "Joint" badge for shared ones). Subtitle: institution name · balance mode ("Ledger" or "Manual"). Right-aligned balance (red if negative). Manual-mode accounts get a wallet icon-button to update their balance directly from this row. A freshness caption underneath reads "Updated Xd ago" / "Never updated", with a warning icon + "stale" label for manual accounts untouched 14+ days (ledger accounts don't need this since they're computed from transactions).

**Account kinds & icons:** Cash (banknote), Checking (bank/landmark), Savings (piggy bank), Credit Card (card), Loan (hand with coins), Investment (trending-up chart).

### Footer
Caption showing the date balances were computed (household timezone). Primary "**+ New account**" button opens the create dialog.

### Empty states
- **No accounts at all:** card with copy + 3 one-tap quick-create buttons (Cash, Checking, Credit Card) that instantly create a shared account in the base currency.
- **Empty tab** (e.g. no "Joint" accounts while others exist): plain centered message.
- **Loading:** skeleton blocks. **Error:** message + Retry button.

### Account create/edit dialog
Modal, fields in order:
1. **Name** (text, required, max 80)
2. **Kind** (select — the 6 kinds above)
3. **Currency** — searchable currency picker (popover with a filter box, code + name, checkmark on selection)
4. **Balance mode** — toggle: **Ledger** (balance computed from transactions) vs **Manual** (typed in directly), each with an explanatory line
5. **Opening balance** (ledger) or **Manual balance** (manual) — locale/decimal-aware masked money input
6. **Credit limit** — only shown when kind = Credit Card
7. **Share toggle** ("Share this account") — off forces private ownership
8. **Ownership** — toggle: **Joint** vs **Mine** (disabled to Joint when not shared); helper note when private: "only you can see this account"

Validation errors inline (name/kind/currency/balance required, "private account needs an owner", generic). Footer: (edit mode) Archive/Restore toggle button on the left; primary **Save** on the right ("Saving…" while pending). A partner's private account is shown read-only (visible balance, no edit controls). Editable rows support drag-to-reorder.

### Manual balance update sheet
Bottom sheet: current balance shown read-only, a single **New value** input, **Save** button.

---

## Transactions

**Route:** `/transactions` (also reachable pre-filtered to one account via a query param, showing an account-detail header with Edit / Update balance / All-transactions actions).

### Primary actions
- **New** button → opens the transaction entry sheet (create mode).
- **New transfer** button → opens the entry sheet in transfer mode.
- **Clear filters** — appears only when a filter is active.

### Filters
Search text (debounced), Type (All/Expense/Income/Transfer), Account (multi-select), Category (multi-select), Member/spender (single-select "All members" or specific), Start date, End date. All filters sync to the URL, so filtered views are shareable/bookmarkable.

### Summary strip
Four stats over the *filtered* results, in base currency: **Count, Inflow, Outflow, Net** (transfers excluded from the money stats).

### List
Grouped by date, each date section showing a subtotal. Each row: transfer icon (if applicable), description, secondary line (date · account · category), amount (red if negative, with a smaller base-currency equivalent line when the transaction's currency differs from the household's base currency), and an edit icon. Tapping the row body also opens edit.
- **Empty (no matches):** dashed-border "no results" box. **Empty (no transactions ever):** different empty copy.
- **Loading:** text. **Error:** message + Retry.
- **Pagination:** "Load more" button (cursor-based, not numbered pages).

### Transaction Entry Sheet
Bottom sheet (centers as a modal on larger screens), two modes:

**Transaction mode (create/edit):**
1. **Expense / Income** toggle (two big buttons) — switching clears the selected category.
2. **Amount** — entered via a **numeric keypad** (3×4 grid: 1–9, decimal point, 0, backspace), not a free-text field; respects locale decimal separator and the currency's minor-unit precision (e.g. CLP has no decimals).
3. **Description** — text, autocompletes from the household's past descriptions.
4. **Account** — select (non-archived accounts); choosing one also sets the transaction currency to that account's currency.
5. **Currency** — separate currency picker, allowing a transaction to be recorded in a different currency than the account's native one.
6. **Category** — select, filtered to the current Expense/Income kind, includes "No category". Auto-suggested from the household's categorization rules based on description/account/kind, unless manually overridden.
7. **Date** (capped at tomorrow) + **Spent by** (household member, or "Joint" for shared).
8. **FX rate** — shown only when the transaction currency differs from the base currency; auto-populated from the day's rate unless manually overridden, with a caption crediting the rate's source.
9. **More/Less** toggle reveals an optional **Notes** field.
10. **Actions:** Save (primary); when editing, also **Duplicate** and **Delete** (with a confirm prompt).
- Last-used account is remembered and pre-selected next time.
- **Offline:** a new transaction is queued locally instead of failing when there's no connection.

**Transfer mode (create only):**
- **From account** / **To account** selects (can't be the same account).
- **From amount** / **To amount** — independent plain decimal inputs, allowing the two legs to differ (covers cross-currency transfers).
- **FX rate** shown per-leg when that leg's currency differs from the base currency.
- **Description** (optional, defaults to "Transfer") and **Date**.
- Transfers are **not supported offline** (blocked entirely, unlike single transactions).

### Money formatting conventions (apply app-wide)
- Currency display always via proper `Intl` currency formatting — decimal places come from the currency itself (e.g. CLP = 0, USD = 2), never hardcoded.
- Negative amounts always use the true minus sign (−), not a hyphen.
- Locale-aware input parsing/masking correctly handles both `1.234,56` and `1,234.56` grouping styles.

---

## Bills

**Route:** `/bills` — recurring/scheduled household bills with a monthly calendar overview, a due-instance list, and a mark-paid/skip workflow.

### Layout
- Header with title/subtitle and a primary "**+ New**" button.
- **Month calendar card**: prev/next month navigation; 7-column grid (Mon–Sun). Each day shows the day number and up to 3 small colored dots (one per bill instance due that day, colored by the responsible member). Today is highlighted. Tapping a day opens that day's first instance detail.
- **Weekly grouped list** below the calendar: sections per ISO week with a running total, each row showing a category icon, bill name, due date (+"Paid by {name}" if paid), amount (struck-through/muted if paid, red if overdue), and a status pill (**due / paid / overdue / skipped**).
- **Empty states:** no bills at all → illustrated empty card with a CTA to create one; a month with no instances but bills existing elsewhere → simple "nothing this month" message.
- **Loading:** skeleton blocks. **Error:** message + Retry.

### Bill editor (create/edit sheet)
1. **Name** (text)
2. **Amount** — optional; leaving it blank marks the bill as **variable-amount** (the actual amount gets entered per occurrence instead)
3. **Currency** (select, defaults to household base currency)
4. **Category** (select, optional)
5. **Account** (select, optional)
6. **Responsible** — "Joint" (default) or a specific member (drives calendar dot color and default payer)
7. **Recurrence** — one of: same day each month, last day of month, weekly (with interval + weekday), yearly, or every N months
8. **Interval** — shown only for weekly/every-N-months
9. **Weekday** — shown only for weekly
10. **Starts on** / **Ends on** (ends-on optional)
11. **Reminder days before** (0–30, default 3)
12. **Recurrence preview** — shows the next several computed due dates live, or an error if the recurrence rule is invalid
- **Save** button, disabled until a name is entered.

### Instance detail sheet
Bill name, due date, amount. Depending on state:
- **Unpaid:** editable per-occurrence amount override + Save; "Mark paid" button (opens the Pay sheet); a skip-reason text field + "Skip" button.
- **Paid:** "Unmark paid" button (confirms first if a linked transaction exists).
- **Skipped:** static "this instance was skipped" message.
- Always: "Edit bill" jumps to the bill editor pre-filled.

### Pay sheet
**Amount** (prefilled), **Paid on** (date, defaults today), **Paid by** (member select), **Create transaction** checkbox (default on — controls whether marking paid also creates a ledger transaction). **Confirm** button.

---

## Budget

**Route:** `/budget` — monthly per-category budget tracking against actual spend.

### Layout
- Header with prev/next month navigation.
- **Scope toggle:** "Household" vs "Mine" — filters budgets/spend to just the current member.
- **Sort control:** Spent / Remaining / Name.
- **Donut chart:** built from the top 7 spending categories (8th+ bucketed into "Other"), centered label shows total spend in base currency.
- **Copy-previous-month prompt:** if the current month has no budgets yet but the previous month did, an outline button offers to copy them forward.
- **Category rows:** each row links to the transactions list pre-filtered to that category + month + expense type. Shows category icon, name, up to 2 recent merchant names, amount spent, "over by X" (red) or "X left" (muted), and a progress bar (red when over budget). Categories with spend but no budget set show a "no budget set" note.
- **Empty state:** illustrated panel when there's no budget or spend data for the period.
- **Loading:** skeletons. **Error:** message + Retry.

### Copy Budgets dialog
Names the source and target month. An **Adjustment %** field applies a blanket bump/cut to every category's copied amount. A scrollable list lets each category's copied amount be individually hand-edited before confirming. **Cancel** / **Confirm** ("Copying…" while pending).

---

## Settings

**Route:** `/settings` — a single scrollable page of stacked cards, in this order:

1. **Signed in as** — user's email, household name + role (Owner/Member).
2. **Locale switcher** — single dropdown (Spanish/English), applies immediately, no save step.
3. **Install (PWA)** — hidden if already installed. Shows an "iOS guide" link, a native "Install" button (Chrome/Android), or "unavailable" text, depending on platform support.
4. **Household members** —
   - Current members list (name, "Owner" badge, joined date).
   - Pending invites list with a live count badge. Owner-only: an email-based invite form ("Invite" button, inline errors for rate-limiting, email delivery failure, or not being the owner), plus per-invite **Resend** / **Revoke** actions and an "Expired" badge on lapsed invites.
5. **Exchange rates** — shows last-updated date (flagged red if stale, >3 days old), a stale-data warning banner, and a "Refresh rates" button.
6. **Manual exchange rate overrides** — read-only list of currency codes with their effective rate, an optional note, and whether it's sourced from an "Override" or the live "Feed", plus the rate's date.
7. **Categories** (embedded; also standalone at `/settings/categories`) —
   - "New" button opens a create dialog; list split into **Expense** and **Income**, hierarchical (child categories indented).
   - Each row: color swatch, emoji icon, name, a "N rules" link to the Rules page, edit and delete icon-buttons.
   - **Create/edit dialog:** Name (required, max 80), Kind (Expense/Income), Parent category (optional, same kind), an emoji icon picker (10 choices), a color picker. Save/Cancel.
8. **Categorization rules** (embedded; also standalone at `/settings/rules`) —
   - "New" button; a **rule tester** input that live-evaluates a typed description against all rules and shows which one would win.
   - Rule list (priority-ordered): pattern (monospace), resolved category + priority, an active/inactive toggle, move up/down reordering buttons, edit/delete.
   - "Bulk apply" button opens a preview dialog showing, per category, how many existing transactions would be recategorized, with an "Apply to N" confirm.
   - **Create/edit dialog:** Match pattern (text, SQL LIKE-style), Category (select, required), Priority (integer). Save/Cancel.
9. **Log out** button at the very bottom.

### `/install` — iOS PWA install guide
Standalone page (not a settings card): a "Back" link to Settings, then three numbered steps, each with a title, description, and a static screenshot illustrating the iOS "Add to Home Screen" flow. Purely instructional.

### Cross-cutting PWA behavior
An app-wide manager tracks install availability and service-worker update state. When an update is ready, a fixed toast appears above the bottom nav with a "Reload" button to activate it.

---

## Global States & Landing Page

### Landing page — `/`
Not gated by auth. A scaffold-era placeholder: centered card titled "duobalance," a short description, a money-formatting demo line, and two footer buttons — "Log in" and "Sign up." No real marketing content exists yet — this is open ground for the redesign.

### Global error boundary
Centered "Something went wrong" heading, the error message (or a generic fallback), and a "Retry" button.

### Global loading boundary
Generic full-page skeleton (title bar + one large block + one bar) shown during route-level suspense — not tailored per page.

### Not found (404)
Centered "404" heading, "Page not found" text, "Back home" button.

---

## Design Opportunities for a Redesign

These are gaps/observations from reading the current implementation, worth calling out explicitly to whoever redesigns this:

- **No brand identity.** No logo, wordmark, consistent header, or illustration system anywhere — auth, onboarding, and settings are all bare centered cards. This is the biggest opportunity for a redesign to add personality.
- **No landing/marketing page.** `/` is a scaffold placeholder, not a real first impression for new users.
- **Navigation is minimal.** Only a 5-tab bottom bar + floating action button exists; there's no persistent header, no household switcher visible outside of first-load onboarding, no way to see "which household am I in" while using the app day-to-day.
- **Trust-signal information deserves visual weight**, not just text: FX rate source (override vs. feed) and date, manual-balance staleness, bill overdue/skipped status, and over-budget indicators are all currently plain text/badges and are central to why this app is trustworthy for shared finances.
- **Empty states are inconsistent in polish** — some (Balances, Bills, Budget) have icons and CTAs; others (Transactions, Rules, Categories) are plain text lines.
- **The numeric keypad for transaction amount entry** is a distinctive, calculator-style interaction already in place — worth preserving and potentially elevating as a signature interaction in the redesign, rather than reverting to a plain text field.
- **Currency and multi-currency handling is pervasive** (per-account currency, per-transaction currency override, FX rate entry, base-currency equivalents shown inline) — any redesign needs to treat this as core information architecture, not an edge case.
