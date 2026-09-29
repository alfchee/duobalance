// Shared helpers for time-limited export links (#269). Server-only — this
// file lives under app/api/** and may import the service-role client, so it
// must never be imported from client code.

import { z } from "zod";

export const exportLinkBodySchema = z.object({
  householdId: z.string().uuid(),
  format: z.enum(["json", "csv"]).default("json"),
});

export const exportTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const EXPORT_LINK_TTL_HOURS = 24;

export function exportLinkUrl(requestUrl: string, token: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}/api/exports/${token}`;
}
