"use client";

import { ApiError } from "@/lib/api-fetch";

// Shared admin display helpers (extracted: formatDate/formatDateTime and the
// ApiError body reader were copy-pasted across all four admin screens).
// The metrics cohort-week label intentionally does NOT live here — it
// formats in UTC (en-CA) so midnight cohorts don't shift a day west of UTC.

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Pull the server's { error } message out of an ApiError, else the fallback. */
export function adminApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body;
    if (typeof body === "object" && body !== null && "error" in body) {
      return String((body as { error: unknown }).error);
    }
  }
  return fallback;
}
