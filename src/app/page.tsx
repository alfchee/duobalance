"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/lib/money";

export default function Home() {
  const t = useTranslations("common");
  const tAuth = useTranslations("auth");
  const locale = useLocale();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center gap-6 p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>duobalance</CardTitle>
          <CardDescription>{t("scaffoldDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            {t("moneyFormatSmokeTest", {
              clp: formatMoney(1234, "CLP", locale),
              usd: formatMoney(1234, "USD", locale),
              brl: formatMoney(1234, "BRL", locale),
            })}
          </p>
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button asChild>
            <a href="/login">{tAuth("login.title")}</a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/signup">{tAuth("signup.title")}</a>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
