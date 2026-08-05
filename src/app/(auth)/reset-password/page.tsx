"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { getAuthErrorKey } from "@/lib/supabase/auth-errors";
import { useSession } from "@/hooks/useSession";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const t = useTranslations("auth.resetPassword");
  const tErrors = useTranslations("auth.errors");

  // A recovery link lands on /reset-password?code=… (PKCE). The code is present
  // when the page mounts and is stripped only after the async code exchange, so
  // capturing it on mount is the reliable way to require a recovery grant — a
  // plain signed-in session must not change the password without the current
  // one. (A useState initializer can't be used: under static export the server
  // render runs first with `window` undefined and hydration keeps that value.)
  const [cameViaRecovery, setCameViaRecovery] = useState(false);
  useEffect(() => {
    setCameViaRecovery(new URLSearchParams(window.location.search).has("code"));
  }, []);

  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);

    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (password !== confirmPassword) {
      setError("mismatch");
      return;
    }

    setPending(true);
    const supabase = createSupabaseBrowser();
    if (!supabase) {
      setError("generic");
      setPending(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setPending(false);
      setError(getAuthErrorKey(updateError));
      return;
    }

    // The recovery-link session exists only to authorize this one update —
    // sign out so the user re-enters the app with a normal login, matching
    // the "you can now log in" copy below.
    await supabase.auth.signOut();
    setPending(false);
    setDone(true);
  }

  if (done) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("successTitle")}</CardTitle>
          <CardDescription>{t("successBody")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={() => router.replace("/login")}>{t("goToLogin")}</Button>
        </CardFooter>
      </Card>
    );
  }

  // A recovery-grant session is required: a plain signed-in session must not
  // change the password without the current one.
  if (!loading && (!session || !cameViaRecovery)) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("invalidLink")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={() => router.replace("/forgot-password")}>{t("requestNewLink")}</Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {tErrors(error)}
            </p>
          ) : null}
          <Button type="submit" disabled={pending || loading}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
