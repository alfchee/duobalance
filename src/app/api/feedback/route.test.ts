import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { collectDiagnosticContext } from "@/lib/diagnostics";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseRouteHandler: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { email: "user@example.com" } },
      }),
    },
  }),
}));

vi.mock("@/lib/feedback-email", () => ({
  sendFeedbackEmail: vi.fn().mockResolvedValue(undefined),
}));

describe("POST /api/feedback", () => {
  it("returns 204 on valid diagnostic context submission", async () => {
    const diagnostics = collectDiagnosticContext({
      householdId: "hh-123",
      memberId: "mem-456",
      accountCount: 2,
      transactionCount: 10,
    });

    const request = new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "problem_report",
        message: "Button broke",
        diagnostics,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(204);
  });

  it("handles double-stringified JSON string bodies gracefully", async () => {
    const diagnostics = collectDiagnosticContext({
      householdId: "hh-123",
      memberId: "mem-456",
    });

    const innerJson = JSON.stringify({
      category: "problem_report",
      message: "Test message",
      diagnostics,
    });

    const request = new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(innerJson),
    });

    const response = await POST(request);
    expect(response.status).toBe(204);
  });

  it("returns 204 when lastError is explicitly null", async () => {
    const diagnostics = {
      ...collectDiagnosticContext({
        householdId: "hh-123",
        memberId: "mem-456",
      }),
      lastError: null,
    };

    const request = new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "problem_report",
        message: "No errors",
        diagnostics,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(204);
  });

  it("returns 400 when body is invalid", async () => {
    const request = new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invalid: true }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
