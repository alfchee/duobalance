"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { useHousehold } from "@/hooks/useHousehold";
import { apiFetch } from "@/lib/api-fetch";
import { supportsPush, urlBase64ToUint8Array } from "@/lib/pwa";

export function PushNotificationsSection() {
  const { householdId, memberId } = useHousehold();
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = useTranslations("pwa.push");

  useEffect(() => {
    if (!supportsPush()) return;
    setAvailable(true);
    void navigator.serviceWorker.ready.then(async (registration) => {
      setEnabled(Boolean(await registration.pushManager.getSubscription()));
    });
  }, []);

  if (!available || !householdId || !memberId) return null;

  async function toggle(nextEnabled: boolean) {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (!nextEnabled) {
        if (current) {
          await apiFetch("/api/push-subscriptions", {
            method: "DELETE",
            body: { householdId, memberId, endpoint: current.endpoint },
          });
          await current.unsubscribe();
        }
        setEnabled(false);
        return;
      }

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) return;
      const subscription =
        current ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        }));
      const keys = subscription.toJSON().keys;
      if (!keys?.p256dh || !keys.auth) return;
      await apiFetch("/api/push-subscriptions", {
        method: "POST",
        body: {
          householdId,
          memberId,
          endpoint: subscription.endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          userAgent: navigator.userAgent,
        },
      });
      setEnabled(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 border-t px-4 py-4">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <Switch
        aria-label={t("title")}
        checked={enabled}
        disabled={busy || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}
        onCheckedChange={(nextEnabled) => void toggle(nextEnabled)}
      />
    </div>
  );
}
