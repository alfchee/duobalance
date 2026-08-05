import { isAuthError } from "@supabase/supabase-js";

// Maps Supabase Auth error codes to keys under the `auth.errors` message
// namespace. AC (#14): auth errors are surfaced as translated, human
// messages — never raw Supabase error strings.
const CODE_TO_KEY: Record<string, string> = {
  invalid_credentials: "invalidCredentials",
  email_not_confirmed: "emailNotConfirmed",
  user_already_exists: "userAlreadyExists",
  email_exists: "userAlreadyExists",
  weak_password: "weakPassword",
  over_request_rate_limit: "rateLimited",
  over_email_send_rate_limit: "rateLimited",
  same_password: "sameNewPassword",
  session_not_found: "sessionExpired",
  session_expired: "sessionExpired",
  refresh_token_not_found: "sessionExpired",
};

// getAuthErrorKey returns a key under `auth.errors` (see messages/*.json).
// Callers do `t(getAuthErrorKey(error))` against a `useTranslations("auth.errors")` scope.
export function getAuthErrorKey(error: unknown): string {
  if (isAuthError(error) && error.code && error.code in CODE_TO_KEY) {
    return CODE_TO_KEY[error.code] as string;
  }
  return "generic";
}
