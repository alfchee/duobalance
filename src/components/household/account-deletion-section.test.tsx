import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, string>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}));
vi.mock("@/lib/api-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-fetch")>()),
  apiFetch: vi.fn(),
}));
vi.mock("@/hooks/useSession", () => ({
  useSession: vi.fn(() => ({ user: { id: "user-1", email: "user@example.com" } })),
}));

import { apiFetch } from "@/lib/api-fetch";
import { AccountDeletionSection } from "./account-deletion-section";

function mockStatus(request: unknown) {
  vi.mocked(apiFetch).mockImplementation((path: string) => {
    if (path === "/api/account/deletion-status") return Promise.resolve({ request });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

describe("AccountDeletionSection", () => {
  it("offers a deletion request when none is open", async () => {
    mockStatus(null);

    render(<AccountDeletionSection />);

    expect(await screen.findByText("settings.accountDeletion.requestButton")).toBeTruthy();
  });

  it("asks for explicit email confirmation while pending", async () => {
    mockStatus({ id: "req-1", status: "pending", scheduled_purge_at: null });

    render(<AccountDeletionSection />);

    expect(await screen.findByText("settings.accountDeletion.pendingNotice")).toBeTruthy();
    // Confirm stays disabled until the typed email matches.
    const confirm = (await screen.findByText("settings.accountDeletion.confirmButton")).closest(
      "button",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/settings.accountDeletion.emailPrompt/), {
      target: { value: "user@example.com" },
    });
    await waitFor(() => expect(confirm.disabled).toBe(false));
  });

  it("shows the grace countdown once confirmed", async () => {
    mockStatus({
      id: "req-1",
      status: "confirmed",
      scheduled_purge_at: "2026-10-29T00:00:00Z",
    });

    render(<AccountDeletionSection />);

    expect(await screen.findByText(/settings.accountDeletion.graceNotice/)).toBeTruthy();
    expect(await screen.findByText("settings.accountDeletion.cancelButton")).toBeTruthy();
  });

  it("shows a load error when the status fetch fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("network down"));

    render(<AccountDeletionSection />);

    expect(await screen.findByText("settings.accountDeletion.loadError")).toBeTruthy();
  });
});
