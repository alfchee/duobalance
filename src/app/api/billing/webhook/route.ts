import { isBillingEnabled } from "@/lib/billing/enabled";
import { InvalidWebhookSignatureError } from "@/lib/billing/provider";
import { getActiveProvider, UnknownProviderError } from "@/lib/billing/registry";

// POST /api/billing/webhook — provider delivery endpoint (issue #262).
// POST-only on purpose: with no GET handler there is nothing to prerender,
// so the Tauri static-export build skips this route entirely (same precedent
// as billing/debug and push-subscriptions).
//
// Reachability, in order:
//   1. Flag off → 404 (the route does not exist yet; the acceptance
//      criterion). Checked before anything else so a probe learns nothing —
//      a 500 here would advertise that something exists and is broken, a 404
//      says nothing. This MUST stay the first check.
//   2. Flag on → the configured provider verifies the signature and the
//      payload is translated into BillingEvents. Signature failures are 401;
//      full dedupe + state-machine application lands in #267, which answers
//      202 here with the parsed count until then.

export async function POST(request: Request) {
  if (!isBillingEnabled()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  try {
    const provider = getActiveProvider();
    const events = await provider.parseWebhook(request);
    return Response.json(
      { received: events.length, provider: provider.id },
      {
        status: 202,
        headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" },
      },
    );
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      return Response.json({ error: "invalid webhook signature" }, { status: 401 });
    }
    if (error instanceof UnknownProviderError) {
      console.error("billing webhook misconfigured:", error);
      return Response.json({ error: "billing webhook failed" }, { status: 500 });
    }
    // NOTE (#267): when a real adapter lands, map malformed payloads to 4xx
    // here — the catch-all 502 below reads as transient and the provider
    // will retry a poison delivery.
    console.error("billing webhook failed:", error);
    return Response.json({ error: "billing webhook failed" }, { status: 502 });
  }
}
