"use client";

import Link from "next/link";
import { ArrowLeft, Share } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function InstallPage() {
  const t = useTranslations("pwa.ios");

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl space-y-6 p-6">
      <Button asChild variant="ghost" className="-ml-3">
        <Link href="/settings">
          <ArrowLeft />
          {t("back")}
        </Link>
      </Button>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stepOne.title")}</CardTitle>
          <CardDescription>{t("stepOne.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center rounded-xl border bg-muted/40 p-8">
            <Share className="size-14 text-primary" aria-label={t("stepOne.title")} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stepTwo.title")}</CardTitle>
          <CardDescription>{t("stepTwo.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border bg-muted/40 p-5 text-center font-medium">
            {t("stepTwo.action")}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stepThree.title")}</CardTitle>
          <CardDescription>{t("stepThree.description")}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
