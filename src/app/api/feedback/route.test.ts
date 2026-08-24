import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { collectDiagnosticContext } from "@/lib/diagnostics";
import { createSupabaseRouteHandler } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseRouteHandler: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "00000000-0000-4000-8000-000000000001", email: "user@example.com" } },
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
      householdId: "00000000-0000-4000-8000-000000000002",
      memberId: "00000000-0000-4000-8000-000000000003",
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
      householdId: "00000000-0000-4000-8000-000000000002",
      memberId: "00000000-0000-4000-8000-000000000003",
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
        householdId: "00000000-0000-4000-8000-000000000002",
        memberId: "00000000-0000-4000-8000-000000000003",
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

  it("requires an authenticated user", async () => {
    vi.mocked(createSupabaseRouteHandler).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never);
    const request = new Request("http://localhost/api/feedback", {
      method: "POST",
      body: JSON.stringify({ diagnostics: {} }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("rejects oversized payloads before processing", async () => {
    const request = new Request("http://localhost/api/feedback", {
      method: "POST",
      body: "x".repeat(16_385),
    });

    const response = await POST(request);
    expect(response.status).toBe(413);
  });

  it("limits feedback submissions per authenticated user", async () => {
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: "00000000-0000-4000-8000-000000000004", email: "limited@example.com" },
          },
        }),
      },
    } as never);
    const body = JSON.stringify({ diagnostics: {} });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await POST(
        new Request("http://localhost/api/feedback", { method: "POST", body }),
      );
      expect(response.status).toBe(204);
    }

    const response = await POST(
      new Request("http://localhost/api/feedback", { method: "POST", body }),
    );
    expect(response.status).toBe(429);
  });
});
