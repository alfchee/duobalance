"use client";

import { useState } from "react";
import Link from "next/link";
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

export default function ForgotPasswordPage() {
  const t = useTranslations("auth.forgotPassword");
  const tErrors = useTranslations("auth.errors");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setPending(true);

    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();

    const supabase = createSupabaseBrowser();
    if (!supabase) {
      setError("generic");
      setPending(false);
      return;
    }

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setPending(false);

    // Don't surface "user not found" distinctly — that would let a caller
    // enumerate which emails have accounts.
    if (resetError && resetError.code !== "user_not_found") {
      setError(getAuthErrorKey(resetError));
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <Card className="w-full rounded-[2rem] border-0 shadow-raised">
        <CardHeader className="gap-2 p-6 sm:p-8">
          <CardTitle className="text-3xl font-black leading-none tracking-tight">
            {t("sentTitle")}
          </CardTitle>
          <CardDescription className="text-base leading-relaxed">{t("sentBody")}</CardDescription>
        </CardHeader>
        <CardFooter className="px-6 pb-6 pt-0 sm:px-8 sm:pb-8">
          <Link
            href="/login"
            className="text-sm font-semibold text-foreground underline-offset-4 hover:underline"
          >
            {t("backToLogin")}
          </Link>
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
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {tErrors(error)}
            </p>
          ) : null}
          <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="p-6 pt-0 sm:px-8 sm:pb-8">
        <Link
          href="/login"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("backToLogin")}
        </Link>
      </CardFooter>
    </Card>
  );
}
