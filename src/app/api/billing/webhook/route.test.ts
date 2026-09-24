import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function post(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ type: "ping" }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.BILLING_ENABLED;
  delete process.env.NEXT_PUBLIC_BILLING_ENABLED;
});

describe("/api/billing/webhook (#262)", () => {
  it("returns 404 — not 500 — when the flag is off", async () => {
    const res = await POST(post());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("returns 404 when the flag is explicitly off", async () => {
    vi.stubEnv("BILLING_ENABLED", "0");
    const res = await POST(post());
    expect(res.status).toBe(404);
  });

  it("returns 404 even with a forged signature header while the flag is off", async () => {
    const res = await POST(post({ "x-stub-signature": "anything" }));
    expect(res.status).toBe(404);
  });

  it("verifies the signature once the flag is on: bad signature is 401, not 404", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    const res = await POST(post({ "x-stub-signature": "wrong" }));
    expect(res.status).toBe(401);
  });
});
