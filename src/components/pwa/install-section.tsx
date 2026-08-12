"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/components/pwa/pwa-manager";
import { isIOS } from "@/lib/pwa";

export function InstallSection() {
  const { install, installAvailable, installed } = usePwaInstall();
  const t = useTranslations("pwa.install");

  if (installed) return null;

  const showIOSGuide = isIOS();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <div>
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
      </div>
    </div>
  );
}
