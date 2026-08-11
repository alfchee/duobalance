import { describe, expect, it, vi } from "vitest";
import {
  getPasswordStrength,
  normalizeEmail,
  requestPasswordReset,
  resetPassword,
  resolvePostAuthDestination,
  signIn,
  signUp,
} from "./flows";

describe("auth flows", () => {
  it("normalizes email and preserves the invite destination", () => {
    expect(normalizeEmail("  PARTNER@example.com ")).toBe("partner@example.com");
    expect(resolvePostAuthDestination("/accept-invite/token")).toBe("/accept-invite/token");
    expect(resolvePostAuthDestination(null)).toBe("/balances");
  });

  it("evaluates password strength independently from the UI", () => {
    expect(getPasswordStrength("")).toBeNull();
    expect(getPasswordStrength("short")).toBe("weak");
    expect(getPasswordStrength("password1")).toBe("fair");
    expect(getPasswordStrength("A-longer-password1!")).toBe("strong");
  });

  it("signs in with normalized credentials and returns the post-auth path", async () => {
    const port = vi.fn().mockResolvedValue({ error: null });
    await expect(
      signIn(port, { email: " PARTNER@example.com ", password: "secret", pendingInvitePath: null }),
    ).resolves.toEqual({ ok: true, value: { redirectTo: "/balances" } });
    expect(port).toHaveBeenCalledWith({ email: "partner@example.com", password: "secret" });
  });

  it("keeps signup responses neutral when no session is returned", async () => {
    const port = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    await expect(
      signUp(port, {
        displayName: " Partner ",
        email: "PARTNER@example.com",
        password: "secret",
        pendingInvitePath: null,
      }),
    ).resolves.toEqual({ ok: true, value: { nextStep: "check-email", redirectTo: null } });
    expect(port).toHaveBeenCalledWith({
      email: "partner@example.com",
      password: "secret",
      options: { data: { display_name: "Partner" } },
    });
  });

  it("handles unknown reset recipients as a successful request", async () => {
    const port = vi.fn().mockResolvedValue({ error: { code: "user_not_found" } });
    await expect(
      requestPasswordReset(port, { email: "PARTNER@example.com", origin: "https://app.example" }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(port).toHaveBeenCalledWith("partner@example.com", {
      redirectTo: "https://app.example/reset-password",
    });
  });

  it("does not update a password when confirmation differs", async () => {
    const updatePassword = vi.fn();
    await expect(
      resetPassword(
        { updatePassword, signOut: vi.fn() },
        { password: "one", confirmPassword: "two" },
      ),
    ).resolves.toEqual({ ok: false, errorKey: "mismatch" });
    expect(updatePassword).not.toHaveBeenCalled();
  });
});
