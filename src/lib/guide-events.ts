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
  | "accept-invite";

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

function parseSlugAndAnchor(href: string): { slug: string; anchor: string | null } {
  // href expected like /help/recording-transaction-fast or /help/slug#anchor
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
  const withoutPrefix = href.startsWith("/help/") ? href.slice("/help/".length) : href;
  const hashIndex = withoutPrefix.indexOf("#");
  if (hashIndex === -1) {
    const slug = withoutPrefix.split("?")[0] ?? withoutPrefix;
    return { slug: slug || href, anchor: null };
  }
  const slugPart = withoutPrefix.slice(0, hashIndex).split("?")[0] ?? "";
  const anchorPart = withoutPrefix.slice(hashIndex + 1) || null;
  return { slug: slugPart || href, anchor: anchorPart };
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
  // Fire-and-forget: never block navigation on tracking failure.
  try {
    await apiFetch("/api/guide-event", {
      method: "POST",
      body: { slug, anchor, source },
    });
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
