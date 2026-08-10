"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePwaInstall } from "@/components/pwa/pwa-manager";
import { isIOS } from "@/lib/pwa";

export function InstallSection() {
  const { install, installAvailable, installed } = usePwaInstall();
  const t = useTranslations("pwa.install");

  if (installed) return null;

  const showIOSGuide = isIOS();
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {showIOSGuide ? (
          <Button asChild variant="outline">
            <Link href="/install">{t("iosGuide")}</Link>
          </Button>
        ) : installAvailable ? (
          <Button onClick={() => void install()}>
            <Download />
            {t("button")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
        )}
      </CardContent>
    </Card>
  );
}
