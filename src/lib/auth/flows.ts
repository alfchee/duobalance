import { getAuthErrorKey } from "@/lib/supabase/auth-errors";

export type AuthErrorResult = { ok: false; errorKey: string };
export type AuthSuccessResult<T> = { ok: true; value: T };
export type AuthResult<T> = AuthErrorResult | AuthSuccessResult<T>;

export type PostAuthDestination = "/balances" | `/accept-invite/${string}`;

export type SignInPort = (input: {
  email: string;
  password: string;
}) => Promise<{ error: unknown }>;

export type SignUpPort = (input: {
  email: string;
  password: string;
  options: { data: { display_name: string } };
}) => Promise<{ data: { session: unknown | null }; error: unknown }>;

export type RequestPasswordResetPort = (
  email: string,
  options: { redirectTo: string },
) => Promise<{ error: { code?: string } | null }>;

export type UpdatePasswordPort = (input: { password: string }) => Promise<{ error: unknown }>;

export type SignOutPort = () => Promise<unknown>;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function resolvePostAuthDestination(pendingInvitePath: string | null): PostAuthDestination {
  return pendingInvitePath?.startsWith("/accept-invite/")
    ? (pendingInvitePath as `/accept-invite/${string}`)
    : "/balances";
}

export function getPasswordStrength(password: string): "weak" | "fair" | "strong" | null {
  if (password.length === 0) return null;
  if (password.length < 8) return "weak";
  const varietyScore = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  if (password.length >= 12 && varietyScore >= 3) return "strong";
  return varietyScore >= 2 ? "fair" : "weak";
}

export async function signIn(
  port: SignInPort | null,
  input: { email: string; password: string; pendingInvitePath: string | null },
): Promise<AuthResult<{ redirectTo: PostAuthDestination }>> {
  if (!port) return { ok: false, errorKey: "generic" };
  const { error } = await port({ email: normalizeEmail(input.email), password: input.password });
  if (error) return { ok: false, errorKey: getAuthErrorKey(error) };
  return { ok: true, value: { redirectTo: resolvePostAuthDestination(input.pendingInvitePath) } };
}

export type SignupNextStep = "household" | "check-email";

export async function signUp(
  port: SignUpPort | null,
  input: { displayName: string; email: string; password: string; pendingInvitePath: string | null },
): Promise<AuthResult<{ nextStep: SignupNextStep; redirectTo: PostAuthDestination | null }>> {
  if (!port) return { ok: false, errorKey: "generic" };
  const { data, error } = await port({
    email: normalizeEmail(input.email),
    password: input.password,
    options: { data: { display_name: input.displayName.trim() } },
  });
  if (error) return { ok: false, errorKey: getAuthErrorKey(error) };

  if (data.session && input.pendingInvitePath) {
    return {
      ok: true,
      value: {
        nextStep: "household",
        redirectTo: resolvePostAuthDestination(input.pendingInvitePath),
      },
    };
  }

  return {
    ok: true,
    value: { nextStep: data.session ? "household" : "check-email", redirectTo: null },
  };
}

export async function requestPasswordReset(
  port: RequestPasswordResetPort | null,
  input: { email: string; origin: string },
): Promise<AuthResult<undefined>> {
  if (!port) return { ok: false, errorKey: "generic" };
  const { error } = await port(normalizeEmail(input.email), {
    redirectTo: `${input.origin}/reset-password`,
  });
  if (error && error.code !== "user_not_found")
    return { ok: false, errorKey: getAuthErrorKey(error) };
  return { ok: true, value: undefined };
}

export async function resetPassword(
  port: { updatePassword: UpdatePasswordPort; signOut: SignOutPort } | null,
  input: { password: string; confirmPassword: string },
): Promise<AuthResult<undefined>> {
  if (input.password !== input.confirmPassword) return { ok: false, errorKey: "mismatch" };
  if (!port) return { ok: false, errorKey: "generic" };
  const { error } = await port.updatePassword({ password: input.password });
  if (error) return { ok: false, errorKey: getAuthErrorKey(error) };
  await port.signOut();
  return { ok: true, value: undefined };
}
