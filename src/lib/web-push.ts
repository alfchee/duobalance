import webpush from "web-push";

export type StoredPushSubscription = {
  id: string;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushDeliveryResult = "sent" | "gone" | "failed";

function configureWebPush() {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
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

export async function sendBillReminderPush(
  subscription: StoredPushSubscription,
  itemCount: number,
  locale: string,
): Promise<PushDeliveryResult> {
  if (!configureWebPush()) {
    console.error("web-push: VAPID env vars not configured — push delivery skipped");
    return "failed";
  }
  const copy = pushCopyFor(locale);
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({
        title: copy.title,
        body: copy.body(itemCount),
        url: "/bills",
      }),
    );
    return "sent";
  } catch (error) {
    if (error instanceof webpush.WebPushError && [404, 410].includes(error.statusCode))
      return "gone";
    console.error("send-bill-reminders: push delivery failed", {
      subscriptionId: subscription.id,
      memberId: subscription.member_id,
      error,
    });
    return "failed";
  }
}
