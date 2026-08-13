import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The BASE prefix is read from process.env at module load, so every test
// reloads the module with a controlled env. Errors are asserted by name/status
// rather than instanceof, since each reload creates a fresh ApiError class.
async function loadApiFetch(base: string) {
  if (base === "") delete process.env.NEXT_PUBLIC_API_BASE_URL;
  else process.env.NEXT_PUBLIC_API_BASE_URL = base;
  vi.resetModules();
  return await import("./api-fetch");
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiFetch", () => {
  it("GETs and parses JSON", async () => {
    const { apiFetch } = await loadApiFetch("");
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await expect(apiFetch("/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/health", expect.any(Object));
  });

  it("serializes a JSON body on non-GET requests", async () => {
    const { apiFetch } = await loadApiFetch("");
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }));
    await apiFetch("/api/items", { method: "POST", body: { id: 1 } });
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"id":1}');
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("merges caller-provided headers with the default content type", async () => {
    const { apiFetch } = await loadApiFetch("");
    fetchMock.mockResolvedValue(jsonResponse({}));
    await apiFetch("/api/items", { headers: { "X-Custom": "1" } });
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Custom": "1",
    });
  });

  it("returns undefined for 204 responses", async () => {
    const { apiFetch } = await loadApiFetch("");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiFetch("/api/items", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("returns a Blob when requested", async () => {
    const { apiFetch } = await loadApiFetch("");
    fetchMock.mockResolvedValue(new Response("backup", { status: 200 }));
    await expect(apiFetch<Blob>("/api/export", { responseType: "blob" })).resolves.toMatchObject({
      size: 6,
      type: "text/plain;charset=utf-8",
    });
  });

  it("throws ApiError with the parsed body on failure", async () => {
    const { apiFetch } = await loadApiFetch("");
    fetchMock.mockResolvedValue(jsonResponse({ message: "nope" }, 400));
    await expect(apiFetch("/api/items")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      body: { message: "nope" },
    });
  });

  it("leaves the body null when the error response is not JSON", async () => {
    const { apiFetch } = await loadApiFetch("");
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(apiFetch("/api/items")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      body: null,
    });
  });

  it("passes absolute URLs through unchanged", async () => {
    const { apiFetch } = await loadApiFetch("");
    fetchMock.mockResolvedValue(jsonResponse({}));
    await apiFetch("https://external.example/x");
    expect(fetchMock).toHaveBeenCalledWith("https://external.example/x", expect.any(Object));
  });

  it("prefixes relative paths with NEXT_PUBLIC_API_BASE_URL", async () => {
    const { apiFetch } = await loadApiFetch("https://api.example.test");
    fetchMock.mockResolvedValue(jsonResponse({}));
    await apiFetch("/health");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/health", expect.any(Object));
  });
});
