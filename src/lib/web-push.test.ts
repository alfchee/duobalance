import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setVapidDetails, sendNotification, generateRequestDetails, MockWebPushError } = vi.hoisted(
  () => {
    class MockWebPushError extends Error {
      statusCode: number;
      constructor(message: string, statusCode: number) {
        super(message);
        this.name = "WebPushError";
        this.statusCode = statusCode;
      }
    }
    return {
      setVapidDetails: vi.fn(),
      sendNotification: vi.fn(),
      generateRequestDetails: vi.fn(),
      MockWebPushError,
    };
  },
);

vi.mock("web-push", () => {
  const webpush = {
    setVapidDetails,
    sendNotification,
    generateRequestDetails,
    WebPushError: MockWebPushError,
  };
  return { default: webpush, ...webpush };
});

import { sendBillReminderPush, type StoredPushSubscription } from "./web-push";

const subscription: StoredPushSubscription = {
  id: "sub-1",
  member_id: "member-1",
  endpoint: "https://push.example/endpoint",
  p256dh: "p256dh-key",
  auth: "auth-key",
};

function setVapidEnv() {
  process.env.VAPID_SUBJECT = "mailto:test@duobalanceapp.com";
  process.env.VAPID_PUBLIC_KEY = "public-key";
  process.env.VAPID_PRIVATE_KEY = "private-key";
}

function clearVapidEnv() {
  delete process.env.VAPID_SUBJECT;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  // Disable the Workers fetch path by default — legacy sendNotification tests cover Node.
  // Make generateRequestDetails throw so the code logs a warn and falls back.
  generateRequestDetails.mockImplementation(() => {
    throw new Error("fetch path disabled in test");
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(new Response(null, { status: 500 })),
  );
  setVapidEnv();
});

afterEach(() => {
  clearVapidEnv();
  vi.restoreAllMocks();
});

describe("sendBillReminderPush", () => {
  it("returns failed and logs when VAPID env vars are not configured", async () => {
    clearVapidEnv();

    const result = await sendBillReminderPush(subscription, 1, "en");

    expect(result).toBe("failed");
    expect(sendNotification).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("VAPID"),
      expect.objectContaining({ subscriptionId: subscription.id }),
    );
  });

  it("sends the notification and returns sent on success", async () => {
    sendNotification.mockResolvedValue(undefined);

    const result = await sendBillReminderPush(subscription, 2, "en");

    expect(result).toBe("sent");
    expect(setVapidDetails).toHaveBeenCalledWith(
      "mailto:test@duobalanceapp.com",
      "public-key",
      "private-key",
    );
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [target, payload] = sendNotification.mock.calls[0]!;
    expect(target).toEqual({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    });
    expect(JSON.parse(payload)).toMatchObject({
      title: "DuoBalance",
      body: "You have 2 bills due soon.",
      url: "/bills",
    });
  });

  it("localizes the notification body for a known locale", async () => {
    sendNotification.mockResolvedValue(undefined);

    await sendBillReminderPush(subscription, 1, "es");

    const [, payload] = sendNotification.mock.calls[0]!;
    expect(JSON.parse(payload)).toMatchObject({ body: "Tienes una factura por vencer." });
  });

  it("falls back to English for an unsupported locale", async () => {
    sendNotification.mockResolvedValue(undefined);

    await sendBillReminderPush(subscription, 1, "pt-BR");

    const [, payload] = sendNotification.mock.calls[0]!;
    expect(JSON.parse(payload)).toMatchObject({ body: "You have a bill due soon." });
  });

  it.each([404, 410])("classifies a %i WebPushError as gone", async (statusCode) => {
    sendNotification.mockRejectedValue(new MockWebPushError("gone", statusCode));

    const result = await sendBillReminderPush(subscription, 1, "en");

    expect(result).toBe("gone");
  });

  it("classifies any other error as failed and logs identifying context", async () => {
    sendNotification.mockRejectedValue(new MockWebPushError("server error", 500));

    const result = await sendBillReminderPush(subscription, 1, "en");

    expect(result).toBe("failed");
    expect(console.error).toHaveBeenCalledWith(
      "send-bill-reminders: push delivery failed",
      expect.objectContaining({
        subscriptionId: subscription.id,
        memberId: subscription.member_id,
      }),
    );
  });

  it("classifies a non-WebPushError failure (e.g. network error) as failed", async () => {
    sendNotification.mockRejectedValue(new Error("network unreachable"));

    const result = await sendBillReminderPush(subscription, 1, "en");

    expect(result).toBe("failed");
  });

  describe("Workers-native fetch path", () => {
    it("delivers via fetch when generateRequestDetails succeeds", async () => {
      const payloadJson = JSON.stringify({
        title: "DuoBalance",
        body: "You have 2 bills due soon.",
        url: "/bills",
      });
      generateRequestDetails.mockReturnValue({
        endpoint: subscription.endpoint,
        method: "POST",
        headers: { Authorization: "vapid", "Content-Encoding": "aes128gcm" },
        body: payloadJson,
      });
      vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 201 }));

      const result = await sendBillReminderPush(subscription, 2, "en");

      expect(result).toBe("sent");
      expect(generateRequestDetails).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        subscription.endpoint,
        expect.objectContaining({ method: "POST" }),
      );
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it.each([404, 410])("classifies %i from fetch as gone", async (statusCode) => {
      generateRequestDetails.mockReturnValue({
        endpoint: subscription.endpoint,
        method: "POST",
        headers: {},
        body: "{}",
      });
      vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: statusCode }));
      vi.spyOn(console, "info").mockImplementation(() => undefined);

      const result = await sendBillReminderPush(subscription, 1, "en");

      expect(result).toBe("gone");
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining("subscription gone"),
        expect.objectContaining({ status: statusCode }),
      );
    });

    it("logs and falls back to sendNotification when fetch path throws", async () => {
      generateRequestDetails.mockImplementation(() => {
        throw new MockWebPushError("crypto unavailable", 500);
      });
      sendNotification.mockResolvedValue(undefined);

      const result = await sendBillReminderPush(subscription, 1, "en");

      expect(result).toBe("sent");
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("falling back to sendNotification"),
        expect.objectContaining({ subscriptionId: subscription.id }),
      );
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it("returns failed and logs when fetch returns non-2xx", async () => {
      generateRequestDetails.mockReturnValue({
        endpoint: subscription.endpoint,
        method: "POST",
        headers: {},
        body: "{}",
      });
      vi.mocked(globalThis.fetch).mockResolvedValue(new Response("push failed", { status: 502 }));

      const result = await sendBillReminderPush(subscription, 1, "en");

      expect(result).toBe("failed");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("push delivery failed (fetch path)"),
        expect.objectContaining({ status: 502 }),
      );
    });
  });
});
