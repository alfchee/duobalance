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

export async function sendBillReminderPush(
  subscription: StoredPushSubscription,
  itemCount: number,
): Promise<PushDeliveryResult> {
  if (!configureWebPush()) return "failed";
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({
        title: "DuoBalance",
        body:
          itemCount === 1 ? "You have a bill due soon." : `You have ${itemCount} bills due soon.`,
        url: "/bills",
      }),
    );
    return "sent";
  } catch (error) {
    if (error instanceof webpush.WebPushError && error.statusCode === 410) return "gone";
    console.error("send-bill-reminders: push delivery failed", error);
    return "failed";
  }
}
