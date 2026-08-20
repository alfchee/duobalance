import { describe, expect, it, vi } from "vitest";
import { FeedbackEmailError, sendFeedbackEmail } from "./feedback-email";
import { collectDiagnosticContext } from "./diagnostics";

vi.mock("resend", () => {
  return {
    Resend: class MockResend {
      emails = {
        send: vi.fn().mockResolvedValue({ error: null }),
      };
    },
  };
});

describe("sendFeedbackEmail", () => {
  it("throws FeedbackEmailError when RESEND_API_KEY is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const diag = collectDiagnosticContext({ householdId: "hh-1" });

    await expect(
      sendFeedbackEmail({
        category: "problem_report",
        message: "Something broke",
        diagnostics: diag,
      }),
    ).rejects.toThrow(FeedbackEmailError);
  });

  it("sends feedback email with household id in subject when RESEND_API_KEY is set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const diag = collectDiagnosticContext({ householdId: "hh-999" });

    await expect(
      sendFeedbackEmail({
        category: "problem_report",
        message: "Everything works great!",
        diagnostics: diag,
        userEmail: "test@example.com",
      }),
    ).resolves.not.toThrow();
  });
});
