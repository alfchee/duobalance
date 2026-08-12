"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pendingInvitePath } from "@/lib/pending-invite";
import { useSession } from "@/hooks/useSession";
import { useAuthCommands } from "@/hooks/useAuthCommands";

type FormState = { errorKey: string | null };
const initialState: FormState = { errorKey: null };

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const { login: submitLogin } = useAuthCommands();
  const t = useTranslations("auth.login");
  const tErrors = useTranslations("auth.errors");

  useEffect(() => {
    if (!loading && session) {
      // An invite in progress (pendingInvitePath) beats /balances: this runs
      // on the session change caused by login too, so peeking keeps both this
      // effect and the submit handler headed to the same place.
      router.replace(pendingInvitePath() ?? "/balances");
    }
  }, [loading, session, router]);

  async function login(_prev: FormState, formData: FormData): Promise<FormState> {
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const result = await submitLogin({ email, password });
    if (!result.ok) return { errorKey: result.errorKey };
    router.replace(result.value.redirectTo);
    return initialState;
  }

  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <Card className="w-full rounded-[2rem] border-0 shadow-raised">
      <CardHeader className="gap-2 p-6 pb-5 sm:p-8 sm:pb-6">
        <h1 className="text-3xl font-black leading-none tracking-tight">{t("title")}</h1>
        <CardDescription className="text-base leading-relaxed">{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="p-6 pt-0 sm:px-8">
        <form action={formAction} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("password")}</Label>
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
              {tErrors(state.errorKey)}
            </p>
          ) : null}
          <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-3 p-6 pt-0 text-sm sm:px-8 sm:pb-8">
        <Link
          href="/forgot-password"
          className="font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("forgotPassword")}
        </Link>
        <p className="text-muted-foreground">
          {t("noAccount")}{" "}
          <Link
            href="/signup"
            className="font-semibold text-foreground underline-offset-4 hover:underline"
          >
            {t("signupLink")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
