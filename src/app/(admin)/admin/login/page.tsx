"use client";

import { useActionState, useEffect } from "react";
import { notFound, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import { useSession } from "@/hooks/useSession";
import { useAuthCommands } from "@/hooks/useAuthCommands";

// Admin sign-in (#271). The admin deployment (admin.duobalanceapp.com) uses
// the same Supabase Auth backend but its cookies are scoped to the admin
// domain, so this session is never shared with the user app — signing in
// here grants no household session, and signing in on the user app grants
// no admin session. Roster membership (public.admin_users) is checked
// per request after sign-in; non-admins see the neutral not-found page.
type FormState = { errorKey: string | null };
const initialState: FormState = { errorKey: null };

export default function AdminLoginPage() {
  const router = useRouter();
  const billingEnabled = useBillingEnabled();
  const { session, loading } = useSession();
  const { login: submitLogin } = useAuthCommands();

  useEffect(() => {
    if (!loading && session) {
      router.replace("/admin");
    }
  }, [loading, session, router]);

  async function login(_prev: FormState, formData: FormData): Promise<FormState> {
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const result = await submitLogin({ email, password });
    if (!result.ok) return { errorKey: result.errorKey };
    router.replace("/admin");
    return initialState;
  }

  const [state, formAction, pending] = useActionState(login, initialState);

  // While billing is off the admin surface does not exist: neutral denial,
  // same as every other admin URL (the API returns 404 there too).
  if (!billingEnabled) {
    notFound();
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <h1 className="text-2xl font-black tracking-tight">Admin sign-in</h1>
        <CardDescription>
          Separate admin session. Household access is never granted from here — there is no
          impersonation path by product decision (docs/admin-boundary.md).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          {state.errorKey ? (
            <p role="alert" className="text-sm text-destructive">
              Sign-in failed. Check your credentials and try again.
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in to admin"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
