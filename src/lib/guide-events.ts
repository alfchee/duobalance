"use client";

import { apiFetch } from "@/lib/api-fetch";

export type GuideSource =
  | "balances-empty"
  | "budget-empty"
  | "bills-empty"
  | "first-run"
  | "help-center"
  | "persistent-help"
  | "help-button";

export type GuideEvent = {
  slug: string;
  anchor?: string | null;
  source?: GuideSource;
};

function parseSlugAndAnchor(href: string): { slug: string; anchor: string | null } {
  // href expected like /help/recording-transaction-fast or /help/slug#anchor
  const withoutPrefix = href.replace(/^\/help\//, "");
  const [slugPart, anchorPart] = withoutPrefix.split("#");
  return { slug: slugPart ?? href, anchor: anchorPart ?? null };
}

export async function trackGuideOpen(href: string, source: GuideSource): Promise<void> {
  const { slug, anchor } = parseSlugAndAnchor(href);
  // Fire-and-forget: never block navigation on tracking failure.
  try {
    await apiFetch("/api/guide-event", {
      method: "POST",
      body: { slug, anchor, source },
    });
  } catch {
    // Fallback to localStorage so funnel can still be approximated offline.
    try {
      const key = "duobalance:guideOpens";
      const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
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
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
