import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  to: "bob@example.com",
  memberName: "Bob",
  householdName: "Casa Duo",
  householdId: "hh-123-uuid",
  locale: "es",
};

async function loadEmail(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return await import("./member-removal-email");
}

beforeEach(() => {
  mockSend.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("sendMemberRemovalEmail", () => {
  it("sends a Spanish removal email with export link and resolved subject", async () => {
    const { sendMemberRemovalEmail } = await loadEmail({
      RESEND_API_KEY: "re_secret",
      APP_URL: "https://app.example.test/",
    });
    mockSend.mockResolvedValue({ error: null });
    await sendMemberRemovalEmail(PARAMS);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "duobalance <notifications@resend.dev>",
        to: "bob@example.com",
        subject: "Has sido removido del hogar Casa Duo",
      }),
    );
    const { html, text } = mockSend.mock.calls[0]![0] as { html: string; text: string };
    const exportUrl = "https://app.example.test/api/export?format=json&householdId=hh-123-uuid";
    expect(html).toContain(exportUrl);
    expect(text).toContain(exportUrl);
  });

  it("uses the English template for en locale", async () => {
    const { sendMemberRemovalEmail } = await loadEmail({
      RESEND_API_KEY: "re_secret",
      APP_URL: "https://app.example.test",
    });
    mockSend.mockResolvedValue({ error: null });
    await sendMemberRemovalEmail({ ...PARAMS, locale: "en" });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "You have been removed from Casa Duo" }),
    );
  });

  it("throws MemberRemovalEmailError when RESEND_API_KEY is missing", async () => {
    const { sendMemberRemovalEmail, MemberRemovalEmailError } = await loadEmail({
      APP_URL: "https://app.example.test",
    });
    await expect(sendMemberRemovalEmail(PARAMS)).rejects.toBeInstanceOf(MemberRemovalEmailError);
  });

  it("throws MemberRemovalEmailError when Resend reports an error", async () => {
    const { sendMemberRemovalEmail, MemberRemovalEmailError } = await loadEmail({
      RESEND_API_KEY: "re_secret",
      APP_URL: "https://app.example.test",
    });
    mockSend.mockResolvedValue({ error: { message: "resend error" } });
    await expect(sendMemberRemovalEmail(PARAMS)).rejects.toBeInstanceOf(MemberRemovalEmailError);
  });
});
