"use client";

import { ApiError, apiFetch } from "@/lib/api-fetch";

export type GuideSource =
  | "balances-empty"
  | "budget-empty"
  | "bills-empty"
  | "first-run"
  | "help-center"
  | "persistent-help"
  | "help-button"
  | "members-invite"
  | "accept-invite"
  | "landing-hero"
  | "guide-view"
  | "guide-scroll"
  | "guide-anchor";

export const GUIDE_SOURCES: readonly GuideSource[] = [
  "balances-empty",
  "budget-empty",
  "bills-empty",
  "first-run",
  "help-center",
  "persistent-help",
  "help-button",
  "members-invite",
  "accept-invite",
  "landing-hero",
  "guide-view",
  "guide-scroll",
  "guide-anchor",
] as const;

export type GuideEvent = {
  slug: string;
  anchor?: string | null;
  source?: GuideSource;
};

const DEDUPE_WINDOW_MS = 5_000;
const recentOpens = new Map<string, number>();

function dedupeKey(slug: string, anchor: string | null, source: GuideSource): string {
  return `${slug}#${anchor ?? ""}:${source}`;
}

function shouldDedupe(slug: string, anchor: string | null, source: GuideSource): boolean {
  const key = dedupeKey(slug, anchor, source);
  const now = Date.now();
  const last = recentOpens.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true;
  recentOpens.set(key, now);
  // Prune old entries
  for (const [k, ts] of recentOpens) {
    if (now - ts > DEDUPE_WINDOW_MS) recentOpens.delete(k);
  }
  return false;
}

function sanitizeSlug(raw: string): string {
  // Keep only safe chars for guide_opens.slug; invalid hrefs (e.g. "/some/other?x=1") would
  // otherwise accumulate as garbage rows. Normalize to kebab-case and fallback to "unknown".
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "unknown";
}

function parseSlugAndAnchor(href: string): { slug: string; anchor: string | null } {
  // href expected like /help/slug, /guia/slug or /guide/slug with optional #anchor
  // Also handles full URLs and missing prefix defensively.
  try {
    // If href is absolute URL, extract pathname+hash
    if (href.startsWith("http://") || href.startsWith("https://")) {
      const url = new URL(href);
      href = `${url.pathname}${url.hash}`;
    }
  } catch {
    // ignore URL parse failure
  }
  let withoutPrefix = href;
  if (href.startsWith("/help/")) withoutPrefix = href.slice("/help/".length);
  else if (href.startsWith("/guia/")) withoutPrefix = href.slice("/guia/".length);
  else if (href.startsWith("/guide/")) withoutPrefix = href.slice("/guide/".length);
  const hashIndex = withoutPrefix.indexOf("#");
  if (hashIndex === -1) {
    const raw = (withoutPrefix.split("?")[0] ?? withoutPrefix).trim();
    const slug = raw ? sanitizeSlug(raw) : sanitizeSlug(href);
    // Validate final slug shape — must be kebab-case; otherwise fallback
    if (!/^[a-z0-9-]+$/.test(slug)) return { slug: "unknown", anchor: null };
    return { slug, anchor: null };
  }
  const slugPart = withoutPrefix.slice(0, hashIndex).split("?")[0] ?? "";
  const anchorPart = withoutPrefix.slice(hashIndex + 1) || null;
  const slug = slugPart ? sanitizeSlug(slugPart) : sanitizeSlug(href);
  const safeSlug = /^[a-z0-9-]+$/.test(slug) ? slug : "unknown";
  const safeAnchor = anchorPart ? anchorPart.slice(0, 200) : null;
  return { slug: safeSlug, anchor: safeAnchor };
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch network failure
  if (err instanceof ApiError) {
    // Only offline/transient should fallback; 4xx validation/401 should not
    return err.status >= 500 || err.status === 0;
  }
  return false;
}

export async function trackGuideOpen(href: string, source: GuideSource): Promise<void> {
  const { slug, anchor } = parseSlugAndAnchor(href);
  if (shouldDedupe(slug, anchor, source)) return;
  // Best-effort active household for attribution — server prefers this over earliest-joined fallback
  let householdId: string | null = null;
  try {
    householdId = localStorage.getItem("duobalance:activeHouseholdId");
  } catch {
    // ignore
  }
  // Fire-and-forget: never block navigation on tracking failure. keepalive survives page navigation (landing-hero).
  try {
    await apiFetch("/api/guide-event", {
      method: "POST",
      body: { slug, anchor, source, householdId: householdId ?? undefined },
      keepalive: true as unknown as undefined,
    } as unknown as Parameters<typeof apiFetch>[1]);
  } catch (err) {
    if (!isNetworkError(err) && !(typeof navigator !== "undefined" && !navigator.onLine)) {
      return;
    }
    // Fallback to localStorage so funnel can still be approximated offline.
    try {
      const key = "duobalance:guideOpens";
      const raw = localStorage.getItem(key);
      let existing: unknown[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          existing = Array.isArray(parsed) ? parsed : [];
        } catch {
          existing = [];
        }
      }
      existing.push({ slug, anchor, source, at: new Date().toISOString(), href });
      localStorage.setItem(key, JSON.stringify(existing.slice(-100)));
    } catch {
      // ignore
    }
  }
}

export function getStoredGuideOpens(): GuideEvent[] {
  try {
    const raw = localStorage.getItem("duobalance:guideOpens");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validate shape: keep only entries with string slug
    return parsed.filter(
      (item): item is GuideEvent =>
        typeof item === "object" && item !== null && typeof (item as GuideEvent).slug === "string",
    );
  } catch {
    return [];
  }
}

export async function flushStoredGuideOpens(): Promise<void> {
  const key = "duobalance:guideOpens";
  let items: GuideEvent[] = [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    items = parsed.filter(
      (item): item is GuideEvent =>
        typeof item === "object" && item !== null && typeof (item as GuideEvent).slug === "string",
    );
    if (items.length === 0) {
      localStorage.removeItem(key);
      return;
    }
  } catch {
    return;
  }

  const remaining: GuideEvent[] = [];
  for (const item of items) {
    try {
      await apiFetch("/api/guide-event", {
        method: "POST",
        body: { slug: item.slug, anchor: item.anchor ?? null, source: item.source },
      });
    } catch (err) {
      if (isNetworkError(err) || (typeof navigator !== "undefined" && !navigator.onLine)) {
        remaining.push(item);
      }
      // 4xx/validation errors are dropped — not retried
    }
  }

  try {
    if (remaining.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(remaining.slice(-100)));
  } catch {
    // ignore
  }
}

// Best-effort auto-flush when connectivity returns. No-op on server.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void flushStoredGuideOpens();
  });
}
