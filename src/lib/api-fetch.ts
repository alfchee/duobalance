const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type ApiFetchInit = Omit<RequestInit, "body"> & { body?: unknown; responseType?: "blob" | "json" };

export async function apiFetch<T = unknown>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const { responseType = "json", ...requestInit } = init;
  const res = await fetch(url, {
    ...requestInit,
    credentials: init.credentials ?? "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, body, `${init.method ?? "GET"} ${path} → ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  if (responseType === "blob") {
    return (await res.blob()) as T;
  }
  return (await res.json()) as T;
}
