import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/hooks/useHousehold", () => ({ useHousehold: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/pwa", () => ({
  supportsPush: vi.fn(),
  urlBase64ToUint8Array: vi.fn(() => new Uint8Array()),
}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "test-public-key" } }));

import { useHousehold } from "@/hooks/useHousehold";
import { apiFetch } from "@/lib/api-fetch";
import { supportsPush } from "@/lib/pwa";
import { PushNotificationsSection } from "./push-notifications-section";

function mockSubscription(overrides: { p256dh?: string; auth?: string } = {}) {
  const p256dh = "p256dh" in overrides ? overrides.p256dh : "p256dh-key";
  const auth = "auth" in overrides ? overrides.auth : "auth-key";
  return {
    endpoint: "https://push.example/subscription",
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => ({ keys: { p256dh, auth } }),
  };
}

function mockServiceWorker(options: {
  existingSubscription?: ReturnType<typeof mockSubscription> | null;
  newSubscription?: ReturnType<typeof mockSubscription>;
}) {
  const getSubscription = vi
    .fn()
    .mockResolvedValue(options.existingSubscription ?? null) as ReturnType<typeof vi.fn>;
  const subscribe = vi
    .fn()
    .mockResolvedValue(options.newSubscription ?? mockSubscription()) as ReturnType<typeof vi.fn>;
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }),
    },
  });
  return { getSubscription, subscribe };
}

beforeEach(() => {
  vi.mocked(useHousehold).mockReturnValue({
    householdId: "household-1",
    memberId: "member-1",
  } as unknown as ReturnType<typeof useHousehold>);
  vi.mocked(supportsPush).mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error -- test-only cleanup of a property defined via defineProperty
  delete navigator.serviceWorker;
});

describe("PushNotificationsSection", () => {
  it("renders nothing when the platform does not support push", () => {
    vi.mocked(supportsPush).mockReturnValue(false);

    const { container } = render(<PushNotificationsSection />);

    expect(container.firstChild).toBeNull();
  });

  it("subscribes and persists the subscription when enabled", async () => {
    const newSubscription = mockSubscription();
    mockServiceWorker({ existingSubscription: null, newSubscription });
    vi.mocked(apiFetch).mockResolvedValue(undefined);

    render(<PushNotificationsSection />);
    fireEvent.click(await screen.findByRole("switch"));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/push-subscriptions",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            householdId: "household-1",
            memberId: "member-1",
            endpoint: newSubscription.endpoint,
            p256dh: "p256dh-key",
            auth: "auth-key",
          }),
        }),
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(newSubscription.unsubscribe).not.toHaveBeenCalled();
  });

  it("rolls back a newly created subscription and shows an error when the server rejects it", async () => {
    const newSubscription = mockSubscription();
    mockServiceWorker({ existingSubscription: null, newSubscription });
    vi.mocked(apiFetch).mockRejectedValue(new Error("server rejected subscription"));

    render(<PushNotificationsSection />);
    fireEvent.click(await screen.findByRole("switch"));

    await screen.findByRole("alert");
    expect(newSubscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("rolls back a newly created subscription that is missing encryption keys instead of leaving it orphaned", async () => {
    const newSubscription = mockSubscription({ p256dh: undefined, auth: undefined });
    mockServiceWorker({ existingSubscription: null, newSubscription });

    render(<PushNotificationsSection />);
    fireEvent.click(await screen.findByRole("switch"));

    await screen.findByRole("alert");
    expect(newSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("does not unsubscribe a pre-existing subscription when the server rejects re-registration", async () => {
    const existingSubscription = mockSubscription();
    mockServiceWorker({ existingSubscription });
    vi.mocked(apiFetch).mockRejectedValue(new Error("server rejected subscription"));

    render(<PushNotificationsSection />);
    // The switch starts checked (an existing subscription was found), so this
    // click means "keep it enabled" and re-registers with the server.
    await waitFor(() =>
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true"),
    );
    fireEvent.click(screen.getByRole("switch"));

    await screen.findByRole("alert");
    expect(existingSubscription.unsubscribe).not.toHaveBeenCalled();
  });

  it("unsubscribes and removes the server-side record when disabled", async () => {
    const existingSubscription = mockSubscription();
    mockServiceWorker({ existingSubscription });
    vi.mocked(apiFetch).mockResolvedValue(undefined);

    render(<PushNotificationsSection />);
    await waitFor(() =>
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true"),
    );
    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(existingSubscription.unsubscribe).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/push-subscriptions",
      expect.objectContaining({
        method: "DELETE",
        body: {
          householdId: "household-1",
          memberId: "member-1",
          endpoint: existingSubscription.endpoint,
        },
      }),
    );
  });
});
