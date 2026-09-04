import webpush from "web-push";

export type StoredPushSubscription = {
  id: string;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushDeliveryResult = "sent" | "gone" | "failed";

type VapidDetails = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

function getVapidDetails(): VapidDetails | null {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}

// Matches the two locales bill-reminder-email.ts's DIGEST_BODY actually
// covers — households on other locales (e.g. pt-BR) fall back to English
// here exactly as the email digest does.
const PUSH_COPY: Record<string, { title: string; body: (itemCount: number) => string }> = {
  en: {
    title: "DuoBalance",
    body: (itemCount) =>
      itemCount === 1 ? "You have a bill due soon." : `You have ${itemCount} bills due soon.`,
  },
  es: {
    title: "DuoBalance",
    body: (itemCount) =>
      itemCount === 1
        ? "Tienes una factura por vencer."
        : `Tienes ${itemCount} facturas por vencer.`,
  },
};

function pushCopyFor(locale: string) {
  return PUSH_COPY[locale] ?? PUSH_COPY.en!;
}

function isGoneStatus(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}

/**
 * Workerd / Workers compatible push delivery.
 *
 * `web-push` was written for Node's `https` and pulls in `node:crypto`.
 * With `nodejs_compat` it can work, but the failure mode on workerd is
 * silent (no delivery, no visible error in cron). To surface failures and
 * to keep the HTTP layer Workers-native we:
 *
 *  1. Generate the encrypted request with `webpush.generateRequestDetails`
 *     (crypto) and deliver it with global `fetch` (Workers-native). This
 *     avoids Node's `https.request` path while still using web-push's
 *     VAPID + aes128gcm encryption.
 *  2. Fall back to `webpush.sendNotification` (Node path) if
 *     `generateRequestDetails` is unavailable or throws in the current
 *     runtime — ensures local `next dev` / Node still works.
 *  3. Every terminal failure is logged with `console.error` including
 *     `subscriptionId` / `memberId` so Workers logs show it.
 *
 * See #157 — a build that compiles is not proof. Only a received
 * notification counts. The fallback + logging ensures silent breakage
 * cannot hide.
 */
export async function sendBillReminderPush(
  subscription: StoredPushSubscription,
  itemCount: number,
  locale: string,
): Promise<PushDeliveryResult> {
  const vapid = getVapidDetails();
  if (!vapid) {
    console.error("web-push: VAPID env vars not configured — push delivery skipped", {
      subscriptionId: subscription.id,
      memberId: subscription.member_id,
    });
    return "failed";
  }

  // Keep web-push's internal VAPID cache coherent for the legacy path.
  try {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  } catch (err) {
    console.error("web-push: setVapidDetails failed", {
      subscriptionId: subscription.id,
      memberId: subscription.member_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }

  const copy = pushCopyFor(locale);
  const payload = JSON.stringify({
    title: copy.title,
    body: copy.body(itemCount),
    url: "/bills",
  });

  // Preferred path: generateRequestDetails + fetch — Workers-native HTTP.
  // If this path throws (e.g. node:crypto not polyfilled), we fall through
  // to the legacy Node https path so local dev / Vercel still works, but the
  // error is logged so workerd breakage is visible in Workers logs.
  const canUseFetchPath =
    typeof webpush.generateRequestDetails === "function" && typeof fetch === "function";

  if (canUseFetchPath) {
    try {
      const details = webpush.generateRequestDetails(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
        {
          // web-push types accept `vapidDetails` but the JS runtime checks
          // either explicit option or the globally-set VAPID.
          TTL: 12 * 60 * 60,
        } as unknown as Record<string, unknown>,
      ) as unknown as {
        endpoint: string;
        method: string;
        headers: Record<string, string>;
        body: string | Uint8Array | Buffer;
      };

      const response = await fetch(details.endpoint, {
        method: details.method,
        headers: details.headers,
        body: details.body as BodyInit,
      });

      if (isGoneStatus(response.status)) return "gone";
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.error("send-bill-reminders: push delivery failed (fetch path)", {
          subscriptionId: subscription.id,
          memberId: subscription.member_id,
          endpointHost: safeHost(subscription.endpoint),
          status: response.status,
          body: text.slice(0, 500),
        });
        return "failed";
      }
      return "sent";
    } catch (error) {
      // Classify WebPushError 404/410 if thrown (some runtimes throw instead of returning status).
      if (error instanceof webpush.WebPushError && isGoneStatus(error.statusCode)) return "gone";

      // Log the fetch-path failure at warn — we will still try the legacy
      // path so a single compat gap doesn't silently suppress delivery.
      console.warn("web-push: fetch delivery path failed, falling back to sendNotification", {
        subscriptionId: subscription.id,
        memberId: subscription.member_id,
        endpointHost: safeHost(subscription.endpoint),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      payload,
    );
    return "sent";
  } catch (error) {
    if (error instanceof webpush.WebPushError && isGoneStatus(error.statusCode)) return "gone";
    console.error("send-bill-reminders: push delivery failed", {
      subscriptionId: subscription.id,
      memberId: subscription.member_id,
      endpointHost: safeHost(subscription.endpoint),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 800) : undefined,
    });
    return "failed";
  }
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}
