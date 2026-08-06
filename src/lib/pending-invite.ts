"use client";

// Carries the accept-invite token through the auth detour (accept page →
// login/signup → back) without putting the bearer token in the URL, where it
// would land in browser history and the Referer header. sessionStorage is
// same-origin and per-tab. Access only happens in client effects/event
// handlers, never at render.

const PENDING_INVITE_STORAGE_KEY = "duobalance:pendingInviteToken";

// Tokens are 43-char base64url (randomBytes) or 48-char hex (legacy migration
// default) — anything below this floor isn't a token we issued.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,}$/;

export function savePendingInvite(token: string): void {
  sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, token);
}

export function peekPendingInvite(): string | null {
  const token = sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
  return token && TOKEN_RE.test(token) ? token : null;
}

export function clearPendingInvite(): void {
  sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
}

// Non-destructive: login/signup consult this to route back to the accept page
// after auth. They must peek, not consume — the session-change effect and the
// submit handler both consult it, and if either removed the token the other
// would see null and bounce to /balances, clobbering the invite redirect.
// The accept page is the only consumer and clears on resolution.
export function pendingInvitePath(): string | null {
  const token = peekPendingInvite();
  return token ? `/accept-invite/${token}` : null;
}
