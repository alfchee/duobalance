"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { isStandalone, type BeforeInstallPromptEvent } from "@/lib/pwa";

interface PwaInstallContextValue {
  installed: boolean;
  install: () => Promise<void>;
  installAvailable: boolean;
}

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

export function usePwaInstall(): PwaInstallContextValue {
  const context = useContext(PwaInstallContext);
  if (!context) throw new Error("usePwaInstall must be used within PwaManager");
  return context;
}

export function PwaManager({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const t = useTranslations("pwa.update");

  useEffect(() => {
    setInstalled(isStandalone());

    const promptListener = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const installedListener = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", promptListener);
    window.addEventListener("appinstalled", installedListener);

    return () => {
      window.removeEventListener("beforeinstallprompt", promptListener);
      window.removeEventListener("appinstalled", installedListener);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
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
      } catch (err) {
        console.error("service worker registration failed", err);
        setRegistration(null);
      }
    };

    void register();
    const reload = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", reload);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", reload);
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch (err) {
      console.error("install prompt failed", err);
    } finally {
      // The prompt is one-shot regardless of outcome — clear it either way
      // so a failure doesn't leave the button offering a dead prompt.
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  return (
    <PwaInstallContext.Provider
      value={{ installed, install, installAvailable: deferredPrompt !== null }}
    >
      {children}
      {updateAvailable ? (
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
      ) : null}
    </PwaInstallContext.Provider>
  );
}
