"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function PwaManager() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const t = useTranslations("pwa.update");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      const nextRegistration = await navigator.serviceWorker.register("/sw.js");
      setRegistration(nextRegistration);
      if (nextRegistration.waiting) setUpdateAvailable(true);
      nextRegistration.addEventListener("updatefound", () => {
        const worker = nextRegistration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller)
            setUpdateAvailable(true);
        });
      });
    };

    void register();
    const reload = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", reload);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", reload);
  }, []);

  if (!updateAvailable) return null;

  return (
    <aside className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-md items-center gap-3 rounded-lg border bg-background p-3 shadow-lg">
      <p className="flex-1 text-sm">{t("message")}</p>
      <Button
        size="sm"
        onClick={() => {
          registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
        }}
      >
        {t("reload")}
      </Button>
    </aside>
  );
}
