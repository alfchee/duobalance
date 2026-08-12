"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FullPageSpinner } from "@/components/full-page-spinner";
import { clearPendingInvite, savePendingInvite } from "@/lib/pending-invite";
import { useSession } from "@/hooks/useSession";
import { useHouseholdCommands } from "@/hooks/useHouseholdCommands";

export function AcceptInviteClient({ token }: { token: string }) {
  const router = useRouter();
  const { session, loading } = useSession();
  const { accept: acceptInvite } = useHouseholdCommands();
  const t = useTranslations("auth.acceptInvite");

  const [state, setState] = useState<"idle" | "accepting" | "success" | "error">("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // While not authenticated, stash the token in sessionStorage so the
  // login/signup detour can route back here — without putting the bearer
  // token in the URL (it would land in history and the Referer header).
  useEffect(() => {
    if (!loading && !session) {
      savePendingInvite(token);
    }
  }, [loading, session, token]);

  // While not authenticated, hang on the "you need an account" screen. The
  // token is preserved through login/signup via sessionStorage, so completing
  // either flow returns here and this effect kicks in.
  useEffect(() => {
    if (loading || !session || state !== "idle") return;

    let cancelled = false;
    setState("accepting");

    async function accept() {
      const result = await acceptInvite(token);

      if (cancelled) return;

      // The invite intent has been resolved (accepted or not) — a stale
      // pending token must not bounce a later /login back to this screen.
      clearPendingInvite();

      if (!result.ok) {
        setState("error");
        setErrorKey(result.errorKey);
        return;
      }
      if (cancelled) return;
      setState("success");
      router.replace("/balances");
    }

    accept();
    return () => {
      cancelled = true;
    };
  }, [acceptInvite, loading, session, state, token, router]);

  if (loading) {
    return <FullPageSpinner />;
  }

  if (!session) {
    return (
      <Card className="w-full rounded-[2rem] border-0 shadow-raised">
        <CardHeader className="gap-2 p-6 pb-5 sm:p-8 sm:pb-6">
          <CardTitle className="text-3xl font-black leading-none tracking-tight">
            {t("notAuthenticatedTitle")}
          </CardTitle>
          <CardDescription className="text-base leading-relaxed">
            {t("notAuthenticatedBody")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-6 pt-0 sm:px-8 sm:pb-8">
          <Button asChild size="lg" className="w-full">
            <Link href="/signup">{t("signupLink")}</Link>
          </Button>
          <Button variant="outline" asChild size="lg" className="w-full">
            <Link href="/login">{t("loginLink")}</Link>
          </Button>
        </CardContent>
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
      <CardContent className="p-6 pt-0 text-sm sm:px-8 sm:pb-8">
        {state === "accepting" ? (
          <p className="text-muted-foreground">{t("accepting")}</p>
        ) : state === "error" && errorKey ? (
          <p role="alert" className="text-destructive">
            {t(`errors.${errorKey}`)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
