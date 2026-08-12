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
import { useSession } from "@/hooks/useSession";
import { useAuthCommands } from "@/hooks/useAuthCommands";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const t = useTranslations("auth.resetPassword");
  const tErrors = useTranslations("auth.errors");
  const { completePasswordReset } = useAuthCommands();

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

    setPending(true);
    const result = await completePasswordReset({ password, confirmPassword });
    if (!result.ok) {
      setPending(false);
      setError(result.errorKey);
      return;
    }
    setPending(false);
    setDone(true);
  }

  if (done) {
    return (
      <Card className="w-full rounded-[2rem] border-0 shadow-raised">
        <CardHeader className="gap-2 p-6 sm:p-8">
          <CardTitle className="text-3xl font-black leading-none tracking-tight">
            {t("successTitle")}
          </CardTitle>
          <CardDescription className="text-base leading-relaxed">
            {t("successBody")}
          </CardDescription>
        </CardHeader>
        <CardFooter className="p-6 pt-0 sm:px-8 sm:pb-8">
          <Button size="lg" className="w-full" onClick={() => router.replace("/login")}>
            {t("goToLogin")}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // A recovery-grant session is required: a plain signed-in session must not
  // change the password without the current one.
  if (!loading && (!session || !cameViaRecovery)) {
    return (
      <Card className="w-full rounded-[2rem] border-0 shadow-raised">
        <CardHeader className="gap-2 p-6 sm:p-8">
          <CardTitle className="text-3xl font-black leading-none tracking-tight">
            {t("title")}
          </CardTitle>
          <CardDescription className="text-base leading-relaxed">
            {t("invalidLink")}
          </CardDescription>
        </CardHeader>
        <CardFooter className="p-6 pt-0 sm:px-8 sm:pb-8">
          <Button size="lg" className="w-full" onClick={() => router.replace("/forgot-password")}>
            {t("requestNewLink")}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full rounded-[2rem] border-0 shadow-raised">
      <CardHeader className="gap-2 p-6 pb-5 sm:p-8 sm:pb-6">
        <CardTitle className="text-3xl font-black leading-none tracking-tight">
          {t("title")}
        </CardTitle>
        <CardDescription className="text-base leading-relaxed">{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="p-6 pt-0 sm:px-8">
        <form action={handleSubmit} className="flex flex-col gap-5">
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
          <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending || loading}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
