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

const ENV_KEYS = ["RESEND_API_KEY", "RESEND_FROM", "RESEND_REPLY_TO"] as const;

const ITEM = { billName: "Rent", dueOn: "2026-08-15", amount: 1234, currency: "USD" };

const PARAMS = {
  to: ["partner@example.com"],
  memberName: "Ana",
  householdName: "Casa 123",
  items: [ITEM],
  locale: "es",
};

// bill-reminder-email.ts reads server env at module load, so each test
// reloads it with a controlled environment.
async function loadEmail(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return await import("./bill-reminder-email");
}

beforeEach(() => {
  mockSend.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("sendReminderDigest", () => {
  it("sends a Spanish digest with a resolved subject and formatted amount", async () => {
    const { sendReminderDigest } = await loadEmail({ RESEND_API_KEY: "re_secret" });
    mockSend.mockResolvedValue({ error: null });

    await sendReminderDigest(PARAMS);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "DuoBalance <hola@duobalance.app>",
        to: ["partner@example.com"],
        subject: "Tienes 1 factura(s) por pagar en Casa 123",
      }),
    );
    const { html, text } = mockSend.mock.calls[0]![0] as { html: string; text: string };
    // formatMoney, not a hand-rolled Intl call — no duplicated currency code
    // (the old formatAmount() produced "USD US$1.234,00"). Intl inserts a
    // non-breaking space before the symbol, hence \s+ rather than a literal one.
    expect(html).toMatch(/1\.234,00\s+US\$/);
    expect(html).not.toContain("USD US$");
    expect(text).toMatch(/1\.234,00\s+US\$/);
  });

  it("uses the English template for en locale", async () => {
    const { sendReminderDigest } = await loadEmail({ RESEND_API_KEY: "re_secret" });
    mockSend.mockResolvedValue({ error: null });

    await sendReminderDigest({ ...PARAMS, locale: "en" });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "You have 1 bill(s) due in Casa 123" }),
    );
  });

  it("falls back to English for an unknown locale", async () => {
    const { sendReminderDigest } = await loadEmail({ RESEND_API_KEY: "re_secret" });
    mockSend.mockResolvedValue({ error: null });

    await sendReminderDigest({ ...PARAMS, locale: "fr" });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "You have 1 bill(s) due in Casa 123" }),
    );
  });

  it("formats a zero-decimal currency without cents", async () => {
    const { sendReminderDigest } = await loadEmail({ RESEND_API_KEY: "re_secret" });
    mockSend.mockResolvedValue({ error: null });

    await sendReminderDigest({
      ...PARAMS,
      items: [{ billName: "Luz", dueOn: "2026-08-15", amount: 5000, currency: "CLP" }],
    });

    const { html } = mockSend.mock.calls[0]![0] as { html: string };
    expect(html).toMatch(/5\.000\s+CLP/);
    expect(html).not.toContain("5000.0000");
  });

  it("escapes user-controlled fields in the HTML", async () => {
    const { sendReminderDigest } = await loadEmail({ RESEND_API_KEY: "re_secret" });
    mockSend.mockResolvedValue({ error: null });

    await sendReminderDigest({
      ...PARAMS,
      memberName: "<img src=x onerror=alert(1)>",
      items: [{ ...ITEM, billName: "<script>alert(1)</script>" }],
    });

    const { html } = mockSend.mock.calls[0]![0] as { html: string };
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("uses RESEND_FROM and RESEND_REPLY_TO when set", async () => {
    const { sendReminderDigest } = await loadEmail({
      RESEND_API_KEY: "re_secret",
      RESEND_FROM: "duobalance <bills@example.com>",
      RESEND_REPLY_TO: "support@example.com",
    });
    mockSend.mockResolvedValue({ error: null });

    await sendReminderDigest(PARAMS);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "duobalance <bills@example.com>",
        replyTo: "support@example.com",
      }),
    );
  });

  it("throws ReminderEmailError when RESEND_API_KEY is missing", async () => {
    const { sendReminderDigest, ReminderEmailError } = await loadEmail({});

    await expect(sendReminderDigest(PARAMS)).rejects.toBeInstanceOf(ReminderEmailError);
    await expect(sendReminderDigest(PARAMS)).rejects.toThrow(/RESEND_API_KEY is not set/);
  });

  it("throws ReminderEmailError when Resend reports an error", async () => {
    const { sendReminderDigest, ReminderEmailError } = await loadEmail({
      RESEND_API_KEY: "re_secret",
    });
    mockSend.mockResolvedValue({ error: { message: "rate limited" } });

    await expect(sendReminderDigest(PARAMS)).rejects.toBeInstanceOf(ReminderEmailError);
    await expect(sendReminderDigest(PARAMS)).rejects.toThrow(/Resend failed: rate limited/);
  });
});
