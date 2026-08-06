"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import { useSession } from "@/hooks/useSession";

type FormState = { errorKey: string | null };
const initialState: FormState = { errorKey: null };

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const t = useTranslations("auth.login");
  const tErrors = useTranslations("auth.errors");

  useEffect(() => {
    if (!loading && session) {
      router.replace("/balances");
    }
  }, [loading, session, router]);

  async function login(_prev: FormState, formData: FormData): Promise<FormState> {
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("password") ?? "");

    const supabase = createSupabaseBrowser();
    if (!supabase) return { errorKey: "generic" };

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { errorKey: getAuthErrorKey(error) };

    // Preserve an invite flow: coming from /accept-invite/{token} via
    // ?next=, land back on the accept screen so the invite is completed.
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next ?? "/balances");
    return { errorKey: null };
  }

  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
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
          <Button type="submit" disabled={pending}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-2 text-sm">
        <Link href="/forgot-password" className="text-muted-foreground hover:underline">
          {t("forgotPassword")}
        </Link>
        <p className="text-muted-foreground">
          {t("noAccount")}{" "}
          <Link href="/signup" className="text-primary hover:underline">
            {t("signupLink")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
