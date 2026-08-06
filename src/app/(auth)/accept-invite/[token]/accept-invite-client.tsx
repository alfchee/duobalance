"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FullPageSpinner } from "@/components/full-page-spinner";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/hooks/useSession";

const ACTIVE_HOUSEHOLD_STORAGE_KEY = "duobalance:activeHouseholdId";

// Maps the accept_invite RPC's RAISE messages (#12) to i18n keys. A generic
// "something went wrong" here would be a support burden — each failure needs
// to tell the partner exactly what to do next.
const RPC_MESSAGE_TO_ERROR_KEY: Record<string, string> = {
  "invite expired": "expired",
  "invite already accepted": "alreadyAccepted",
  "invite email does not match authenticated user": "emailMismatch",
  "invite not found": "invalidToken",
};

export function AcceptInviteClient({ token }: { token: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, loading } = useSession();
  const t = useTranslations("auth.acceptInvite");

  const [state, setState] = useState<"idle" | "accepting" | "success" | "error">("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // While not authenticated, hang on the "you need an account" screen. The
  // token is preserved through login/signup via ?next=/accept-invite/{token},
  // so completing either flow returns here and this effect kicks in.
  useEffect(() => {
    if (loading || !session || state !== "idle") return;

    let cancelled = false;
    setState("accepting");

    async function accept() {
      const supabase = createSupabaseBrowser();
      if (!supabase) {
        setState("error");
        setErrorKey("generic");
        return;
      }

      const { data: householdId, error } = await supabase.rpc("accept_invite", { p_token: token });

      if (cancelled) return;

      if (error) {
        setState("error");
        setErrorKey(RPC_MESSAGE_TO_ERROR_KEY[error.message] ?? "generic");
        return;
      }

      if (householdId) {
        localStorage.setItem(ACTIVE_HOUSEHOLD_STORAGE_KEY, String(householdId));
      }
      await queryClient.invalidateQueries({ queryKey: ["households", "memberships"] });
      if (cancelled) return;
      setState("success");
      router.replace("/balances");
    }

    accept();
    return () => {
      cancelled = true;
    };
  }, [loading, session, state, token, queryClient, router]);

  if (loading) {
    return <FullPageSpinner />;
  }

  const next = `/accept-invite/${token}`;

  if (!session) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("notAuthenticatedTitle")}</CardTitle>
          <CardDescription>{t("notAuthenticatedBody")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button asChild>
            <Link href={`/signup?next=${next}`}>{t("signupLink")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/login?next=${next}`}>{t("loginLink")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
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
