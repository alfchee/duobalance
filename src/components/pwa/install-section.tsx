"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isIOS, isStandalone } from "@/lib/pwa";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

export function InstallSection() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const t = useTranslations("pwa.install");

  useEffect(() => {
    const promptListener = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const installedListener = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", promptListener);
    window.addEventListener("appinstalled", installedListener);
    return () => {
      window.removeEventListener("beforeinstallprompt", promptListener);
      window.removeEventListener("appinstalled", installedListener);
    };
  }, []);

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
        ) : deferredPrompt ? (
          <Button
            onClick={() => {
              void deferredPrompt.prompt().then(() => setDeferredPrompt(null));
            }}
          >
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
