"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const IOS_GUIDE_SCREENSHOTS = {
  share: "/install/ios-share.png",
  addToHomeScreen: "/install/ios-add-to-home-screen.png",
  homeScreen: "/install/ios-home-screen.png",
} as const;

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
          <Image
            src={IOS_GUIDE_SCREENSHOTS.share}
            alt={t("stepOne.screenshotAlt")}
            className="w-full rounded-xl border"
            width={390}
            height={260}
            unoptimized
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stepTwo.title")}</CardTitle>
          <CardDescription>{t("stepTwo.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Image
            src={IOS_GUIDE_SCREENSHOTS.addToHomeScreen}
            alt={t("stepTwo.screenshotAlt")}
            className="w-full rounded-xl border"
            width={390}
            height={260}
            unoptimized
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stepThree.title")}</CardTitle>
          <CardDescription>{t("stepThree.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Image
            src={IOS_GUIDE_SCREENSHOTS.homeScreen}
            alt={t("stepThree.screenshotAlt")}
            className="w-full rounded-xl border"
            width={390}
            height={260}
            unoptimized
          />
        </CardContent>
      </Card>
    </main>
  );
}
