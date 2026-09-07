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
    from: vi.fn().mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.is = vi.fn().mockReturnValue(chain);
      chain.maybeSingle = vi.fn().mockResolvedValue({
        data:
          table === "household_members"
            ? {
                id: "00000000-0000-4000-8000-000000000003",
                household_id: "00000000-0000-4000-8000-000000000002",
                user_id: "00000000-0000-4000-8000-000000000001",
              }
            : null,
      });
      chain.insert = vi.fn().mockResolvedValue({ error: null });
      return chain;
    }),
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
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null });
    chain.insert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn().mockReturnValue(chain),
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
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "00000000-0000-4000-8000-000000000004",
        household_id: "00000000-0000-4000-8000-000000000002",
        user_id: "00000000-0000-4000-8000-000000000004",
      },
    });
    chain.insert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: "00000000-0000-4000-8000-000000000004", email: "limited@example.com" },
          },
        }),
      },
      from: vi.fn().mockReturnValue(chain),
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

  it("persists feedback to DB alongside email delivery", async () => {
    const { sendFeedbackEmail } = await import("@/lib/feedback-email");
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const createMemberChain = (data: unknown) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.is = vi.fn().mockReturnValue(chain);
      chain.maybeSingle = vi.fn().mockResolvedValue({ data });
      chain.insert = insertMock;
      return chain;
    };
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "household_members") {
        return createMemberChain({
          id: "00000000-0000-4000-8000-000000000007",
          household_id: "00000000-0000-4000-8000-000000000006",
          user_id: "00000000-0000-4000-8000-000000000005",
        });
      }
      return createMemberChain(null);
    });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: "00000000-0000-4000-8000-000000000005", email: "persist@example.com" },
          },
        }),
      },
      from: mockFrom,
    } as never);

    const diagnostics = collectDiagnosticContext({
      householdId: "00000000-0000-4000-8000-000000000006",
      memberId: "00000000-0000-4000-8000-000000000007",
    });

    const request = new Request("http://localhost/api/feedback", {
      method: "POST",
      body: JSON.stringify({ category: "general", message: "Great app", diagnostics }),
    });

    const response = await POST(request);
    expect(response.status).toBe(204);
    expect(mockFrom).toHaveBeenCalledWith("feedback_submissions");
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: "00000000-0000-4000-8000-000000000006",
        user_id: "00000000-0000-4000-8000-000000000005",
        member_id: "00000000-0000-4000-8000-000000000007",
        category: "general",
        message: "Great app",
      }),
    );
    expect(sendFeedbackEmail).toHaveBeenCalled();
  });

  it("still sends email even if DB persist fails", async () => {
    const { sendFeedbackEmail } = await import("@/lib/feedback-email");
    const { collectDiagnosticContext } = await import("@/lib/diagnostics");
    vi.mocked(sendFeedbackEmail).mockResolvedValueOnce(undefined);
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.is = vi.fn().mockReturnValue(chain);
      if (table === "household_members") {
        chain.maybeSingle = vi.fn().mockResolvedValue({
          data: {
            id: "00000000-0000-4000-8000-000000000009",
            household_id: "00000000-0000-4000-8000-000000000006",
            user_id: "00000000-0000-4000-8000-000000000008",
          },
        });
      } else {
        chain.maybeSingle = vi.fn().mockResolvedValue({ data: null });
      }
      chain.insert =
        table === "feedback_submissions"
          ? vi.fn().mockResolvedValue({ error: { message: "db error" } })
          : vi.fn().mockResolvedValue({ error: null });
      return chain;
    });
    vi.mocked(createSupabaseRouteHandler).mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: "00000000-0000-4000-8000-000000000008", email: "dbfail@example.com" },
          },
        }),
      },
      from: mockFrom,
    } as never);

    const diagnostics = collectDiagnosticContext({
      householdId: "00000000-0000-4000-8000-000000000006",
      memberId: "00000000-0000-4000-8000-000000000009",
    });

    const request = new Request("http://localhost/api/feedback", {
      method: "POST",
      body: JSON.stringify({ diagnostics }),
    });

    const response = await POST(request);
    expect(response.status).toBe(204);
    expect(sendFeedbackEmail).toHaveBeenCalled();
  });
});
