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

import { sendDunningEmail, type DunningEmailParams } from "./dunning-email";

const BASE: Omit<DunningEmailParams, "stage"> = {
  to: ["ana@test.local"],
  memberName: "Ana",
  householdName: "Casa Luna",
  manageUrl: "https://app.test/settings",
};

// dunning-email.ts reads server env at call time (getResendConfig), so no
// module reload is needed — just set or clear the env per test.
beforeEach(() => {
  mockSend.mockReset();
  process.env.RESEND_API_KEY = "re_secret";
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  delete process.env.RESEND_REPLY_TO;
});

// Words that shame the recipient. A declined card can mean money is
// genuinely tight — the exact situation DuoBalance exists to help with —
// so none of these may appear in any subject, html or text body.
const SHAMING = ["moros", "deuda", "impago", "impaga", "culpa", "vergüenza", "castigo", "suspend"];

describe("sendDunningEmail (#265)", () => {
  it("sends the first reminder in Spanish with a non-shaming subject", async () => {
    mockSend.mockResolvedValue({ error: null });

    await sendDunningEmail({ ...BASE, stage: "first_reminder" });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "DuoBalance <hola@duobalanceapp.com>",
        to: ["ana@test.local"],
        subject: "Tuvimos un problema con tu pago de DuoBalance",
      }),
    );
    const { html, text } = mockSend.mock.calls[0]![0] as { html: string; text: string };
    const combined = `${html} ${text}`.toLowerCase();
    for (const word of SHAMING) {
      expect(combined, `copy must not contain "${word}"`).not.toContain(word);
    }
    expect(html).toContain("sigue a salvo");
    expect(text).toContain("https://app.test/settings");
  });

  it("escalates tone across stages without ever shaming", async () => {
    mockSend.mockResolvedValue({ error: null });

    await sendDunningEmail({ ...BASE, stage: "second_reminder" });
    await sendDunningEmail({
      ...BASE,
      stage: "final_notice",
      graceEndsOn: "2026-09-30",
    });

    const subjects = mockSend.mock.calls.map((call) => (call[0] as { subject: string }).subject);
    expect(subjects).toEqual([
      "Recordatorio: tu pago de DuoBalance sigue pendiente",
      "Último aviso: tu acceso a DuoBalance termina pronto",
    ]);
    for (const call of mockSend.mock.calls) {
      const { html, text } = call[0] as { html: string; text: string };
      const combined = `${html} ${text}`.toLowerCase();
      for (const word of SHAMING) {
        expect(combined, `copy must not contain "${word}"`).not.toContain(word);
      }
    }
    const finalHtml = (mockSend.mock.calls[1]![0] as { html: string }).html;
    expect(finalHtml).toContain("2026-09-30");
    expect(finalHtml).toContain("tus datos se conservan");
  });

  it("renders in a mobile-friendly single column", async () => {
    mockSend.mockResolvedValue({ error: null });

    await sendDunningEmail({ ...BASE, stage: "final_notice" });

    const { html } = mockSend.mock.calls[0]![0] as { html: string };
    expect(html).toContain("max-width: 480px");
    expect(html).toContain("system-ui");
    // Touch-sized CTA.
    expect(html).toContain("padding: 12px 24px");
  });

  it("throws DunningEmailError when Resend reports an error", async () => {
    mockSend.mockResolvedValue({ error: { message: "rate limited" } });

    await expect(sendDunningEmail({ ...BASE, stage: "first_reminder" })).rejects.toThrow(
      /Resend failed: rate limited/,
    );
  });

  it("throws when RESEND_API_KEY is not set", async () => {
    delete process.env.RESEND_API_KEY;

    await expect(sendDunningEmail({ ...BASE, stage: "first_reminder" })).rejects.toThrow(
      /RESEND_API_KEY is not set/,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });
});
