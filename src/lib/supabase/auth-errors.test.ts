import { describe, expect, it } from "vitest";
import { getAuthErrorKey } from "./auth-errors";

// isAuthError (from supabase-js) only looks for the `__isAuthError` marker, so
// a plain object with that flag stands in for a real AuthApiError.
function authError(code: string) {
  return { __isAuthError: true, code };
}

describe("getAuthErrorKey", () => {
  it("maps known error codes to message keys", () => {
    expect(getAuthErrorKey(authError("invalid_credentials"))).toBe("invalidCredentials");
    expect(getAuthErrorKey(authError("email_not_confirmed"))).toBe("emailNotConfirmed");
    expect(getAuthErrorKey(authError("weak_password"))).toBe("weakPassword");
    expect(getAuthErrorKey(authError("same_password"))).toBe("sameNewPassword");
  });

  it("maps the rate-limit codes to a single key", () => {
    expect(getAuthErrorKey(authError("over_request_rate_limit"))).toBe("rateLimited");
    expect(getAuthErrorKey(authError("over_email_send_rate_limit"))).toBe("rateLimited");
  });

  it("maps session codes to sessionExpired", () => {
    expect(getAuthErrorKey(authError("session_not_found"))).toBe("sessionExpired");
    expect(getAuthErrorKey(authError("session_expired"))).toBe("sessionExpired");
    expect(getAuthErrorKey(authError("refresh_token_not_found"))).toBe("sessionExpired");
  });

  it("deliberately does not expose account-enumeration codes", () => {
    // user_already_exists / email_exists would let a client probe registered
    // emails, so they fall through to the generic message.
    expect(getAuthErrorKey(authError("user_already_exists"))).toBe("generic");
    expect(getAuthErrorKey(authError("email_exists"))).toBe("generic");
  });

  it("returns generic for unknown codes", () => {
    expect(getAuthErrorKey(authError("something_else"))).toBe("generic");
  });

  it("returns generic for a non-auth error", () => {
    expect(getAuthErrorKey(new Error("nope"))).toBe("generic");
    expect(getAuthErrorKey(null)).toBe("generic");
    expect(getAuthErrorKey(undefined)).toBe("generic");
  });
});
