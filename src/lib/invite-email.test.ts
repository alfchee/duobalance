import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Vitest requires factory-referenced variables to start with `mock`. The
// shared mockSend is addressable across module reloads, unlike the per-instance
// Resend mock.
const mockSend = vi.fn();

vi.mock("resend", () => {
  class MockResend {
    emails = { send: mockSend };
    constructor(_apiKey: string) {}
  }
  return { Resend: MockResend };
});

const ENV_KEYS = ["RESEND_API_KEY", "APP_URL", "RESEND_FROM"] as const;
const PARAMS = {
  to: "partner@example.com",
  inviterName: "Ana",
  householdName: "Casa 123",
  token: "tok-abc-123",
  locale: "es",
};

// invite-email.ts reads server env at module load, so each test reloads it
// with a controlled environment.
async function loadEmail(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return await import("./invite-email");
}

beforeEach(() => {
  mockSend.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("sendInviteEmail", () => {
  it("sends a Spanish invite with the accept link and resolved subject", async () => {
    const { sendInviteEmail } = await loadEmail({
      RESEND_API_KEY: "re_secret",
      APP_URL: "https://app.example.test/",
    });
    mockSend.mockResolvedValue({ error: null });
    await sendInviteEmail(PARAMS);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "duobalance <invites@resend.dev>",
        to: "partner@example.com",
        subject: "Ana te invitó a Casa 123",
      }),
    );
    const { html, text } = mockSend.mock.calls[0]![0] as { html: string; text: string };
    const acceptUrl = "https://app.example.test/accept-invite/tok-abc-123";
    expect(html).toContain(acceptUrl);
    expect(text).toContain(acceptUrl);
  });

  it("uses the English template for en locale", async () => {
    const { sendInviteEmail } = await loadEmail({
      RESEND_API_KEY: "re_secret",
      APP_URL: "https://app.example.test",
    });
    mockSend.mockResolvedValue({ error: null });
    await sendInviteEmail({ ...PARAMS, locale: "en" });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Ana invited you to Casa 123" }),
    );
  });

  it("falls back to English for an unknown locale", async () => {
    const { sendInviteEmail } = await loadEmail({
      RESEND_API_KEY: "re_secret",
      APP_URL: "https://app.example.test",
    });
    mockSend.mockResolvedValue({ error: null });
    await sendInviteEmail({ ...PARAMS, locale: "fr" });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Ana invited you to Casa 123" }),
    );
  });

  it("escapes user-controlled fields in the HTML", async () => {
    const { sendInviteEmail } = await loadEmail({
      RESEND_API_KEY: "re_secret",
      APP_URL: "https://app.example.test",
    });
    mockSend.mockResolvedValue({ error: null });
    await sendInviteEmail({ ...PARAMS, inviterName: "<img src=x onerror=alert(1)>" });
    const { html } = mockSend.mock.calls[0]![0] as { html: string };
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });

  it("uses RESEND_FROM when set", async () => {
    const { sendInviteEmail } = await loadEmail({
      RESEND_API_KEY: "re_secret",
      APP_URL: "https://app.example.test",
      RESEND_FROM: "duobalance <invites@example.com>",
    });
    mockSend.mockResolvedValue({ error: null });
    await sendInviteEmail(PARAMS);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: "duobalance <invites@example.com>" }),
    );
  });

  it("throws InviteEmailError when RESEND_API_KEY is missing", async () => {
    const { sendInviteEmail, InviteEmailError } = await loadEmail({
      APP_URL: "https://app.example.test",
    });
    await expect(sendInviteEmail(PARAMS)).rejects.toBeInstanceOf(InviteEmailError);
    await expect(sendInviteEmail(PARAMS)).rejects.toThrow(/RESEND_API_KEY is not set/);
  });

  it("throws InviteEmailError when APP_URL is missing", async () => {
    const { sendInviteEmail, InviteEmailError } = await loadEmail({
      RESEND_API_KEY: "re_secret",
    });
    await expect(sendInviteEmail(PARAMS)).rejects.toBeInstanceOf(InviteEmailError);
    await expect(sendInviteEmail(PARAMS)).rejects.toThrow(/APP_URL is not set/);
  });

  it("throws InviteEmailError when Resend reports an error", async () => {
    const { sendInviteEmail, InviteEmailError } = await loadEmail({
      RESEND_API_KEY: "re_secret",
      APP_URL: "https://app.example.test",
    });
    mockSend.mockResolvedValue({ error: { message: "rate limited" } });
    await expect(sendInviteEmail(PARAMS)).rejects.toBeInstanceOf(InviteEmailError);
    await expect(sendInviteEmail(PARAMS)).rejects.toThrow(/Resend failed: rate limited/);
  });
});
