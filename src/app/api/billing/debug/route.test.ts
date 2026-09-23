import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/app/api/_shared", () => {
  class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    HttpError,
    createRouteContext: vi.fn(),
    getAuthedUser: vi.fn(),
  };
});
import { getAuthedUser } from "@/app/api/_shared";

const authed = vi.mocked(getAuthedUser);

function post(body: unknown): Request {
  return new Request("http://localhost/api/billing/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.BUILD_TARGET;
  vi.clearAllMocks();
});

describe("/api/billing/debug (#259)", () => {
  it("returns 404 in production without leaking existence", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(post({ action: "status" }));
    expect(res.status).toBe(404);
    expect(authed).not.toHaveBeenCalled();
  });

  it("returns 404 on tauri builds", async () => {
    vi.stubEnv("BUILD_TARGET", "tauri");
    const res = await POST(post({ action: "status" }));
    expect(res.status).toBe(404);
  });

  it("requires authentication outside production", async () => {
    const { HttpError } = await import("@/app/api/_shared");
    authed.mockRejectedValueOnce(new HttpError(401, "authentication required"));
    const res = await POST(post({ action: "status" }));
    expect(res.status).toBe(401);
  });

  it("rejects unknown actions with 400", async () => {
    authed.mockResolvedValueOnce({ id: "user_1" } as never);
    const res = await POST(post({ action: "explode" }));
    expect(res.status).toBe(400);
  });

  it("drives the stub: checkout, advance, fail-renewal, redeliver, status", async () => {
    authed.mockResolvedValue({ id: "user_1" } as never);

    const reset = await POST(post({ action: "reset" }));
    expect(reset.status).toBe(200);

    const checkout = await POST(
      post({ action: "checkout", householdId: "hh_1", planCode: "plus" }),
    );
    expect(checkout.status).toBe(200);
    const { reference } = (await checkout.json()) as { reference: string };
    expect(reference).toMatch(/^stub_sub_/);

    const failed = await POST(post({ action: "fail-renewal", ref: reference }));
    expect(failed.status).toBe(200);
    expect(((await failed.json()) as { status: string }).status).toBe("past_due");

    const status = await POST(post({ action: "status" }));
    expect(status.status).toBe(200);
    const snapshot = (await status.json()) as {
      now: string;
      subscriptions: { ref: string; status: string }[];
      outboxSize: number;
    };
    expect(snapshot.subscriptions).toHaveLength(1);
    expect(snapshot.subscriptions[0]?.status).toBe("past_due");
    expect(snapshot.outboxSize).toBeGreaterThan(0);

    const advanced = await POST(post({ action: "advance-time", ms: 7 * 24 * 60 * 60 * 1000 }));
    expect(advanced.status).toBe(200);
  });

  it("surfaces stub errors as 422, not 500s", async () => {
    authed.mockResolvedValue({ id: "user_1" } as never);
    const res = await POST(post({ action: "advance", ref: "stub_sub_999", status: "active" }));
    expect(res.status).toBe(422);
  });

  it("rejects non-ISO currencies at the domain Money boundary with 422", async () => {
    authed.mockResolvedValue({ id: "user_1" } as never);
    const res = await POST(
      post({
        action: "inject",
        events: [
          {
            type: "payment.succeeded",
            ref: "stub_sub_1",
            amount: { amount: 1, currency: "ABC" },
            periodEnd: "2026-10-23T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(res.status).toBe(422);
  });
});
