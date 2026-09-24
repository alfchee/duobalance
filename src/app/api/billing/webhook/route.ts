import { systemClock } from "@/lib/billing/clock";
import { isBillingEnabled } from "@/lib/billing/enabled";
import { applyBillingEvent } from "@/lib/billing/lifecycle";
import {
  InvalidWebhookSignatureError,
  type BillingEvent,
  type PaymentProvider,
  type WebhookDelivery,
} from "@/lib/billing/provider";
import { getActiveProvider, UnknownProviderError } from "@/lib/billing/registry";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// POST /api/billing/webhook — provider delivery endpoint (issues #262, #267).
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
//      payload is translated into BillingEvents. Signature failures are 401
//      with zero state change (verification precedes every write).
//   3. Every delivery is persisted to billing_events BEFORE processing via
//      applyBillingEvent (#260), which keys idempotency on
//      (provider, provider_event_id): a redelivered id returns `duplicate`
//      with zero state touch, and a crash between receipt and apply leaves
//      processed_at null so the provider's retry adopts the stranded row.
//      Persist first, then process — a crash after a successful write is a
//      no-op on the insert and a re-attempt on the apply.
//
// Outcome → status map (all recorded outcomes are 200 — the delivery is
// handled and must NOT be retried; only genuine failures are 5xx):
//   applied / duplicate / ignored / rejected → 200 (duplicate is the
//     already-processed idempotent replay; ignored is a stale event such as
//     a payment crossing a cancellation; rejected is an unknown transition
//     or plan, recorded in the ledger for inspection)
//   InvalidWebhookSignatureError → 401 (no state touched)
//   throw from applyBillingEvent (DB failure, write-write race) → 500 so
//     the provider retries; processed_at stays null so the retry succeeds
//   UnknownProviderError / client construction → 500 (misconfigured server)
//
// Creation path: subscription.activated for an unknown ref needs a
// householdId the webhook payload does not carry (BillingEvent is
// provider-vocabulary only, #258). The route passes none, so such a
// delivery is a RECORDED rejection (200), never a throw — checkout context
// (#264) wires household resolution up later; until then rows created
// through checkout-adjacent paths update normally here.
//
// Logging is structured JSON with provider, delivery id, event type and
// outcome only — never the payload, amount, plan code or any household
// detail. No card data or personal detail reaches the logs.
//
// Workers-safe: web Request/Response only, no Node APIs, no next/headers.
// Cross-household writes run on the service role (same privilege pattern as
// the billing-expire cron); billing_events has no authenticated policies by
// design (#257), so the service role is the only writer.

const NO_STORE = { "Cache-Control": "private, no-store", Pragma: "no-cache" };

type Outcome = "applied" | "duplicate" | "ignored" | "rejected";

export async function POST(request: Request) {
  if (!isBillingEnabled()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  let provider: PaymentProvider;
  try {
    provider = getActiveProvider();
  } catch (error) {
    console.error(
      JSON.stringify({
        msg: "billing webhook misconfigured",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return Response.json({ error: "billing webhook failed" }, { status: 500 });
  }

  let deliveries: WebhookDelivery[];
  try {
    deliveries = await verifyAndTranslate(provider, request);
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      return Response.json({ error: "invalid webhook signature" }, { status: 401 });
    }
    if (error instanceof UnknownProviderError) {
      console.error(
        JSON.stringify({
          msg: "billing webhook misconfigured",
          error: error.name,
        }),
      );
      return Response.json({ error: "billing webhook failed" }, { status: 500 });
    }
    console.error(
      JSON.stringify({
        msg: "billing webhook verification failed",
        provider: provider.id,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return Response.json({ error: "billing webhook failed" }, { status: 500 });
  }

  let db: ReturnType<typeof createSupabaseServiceRoleClient>;
  try {
    db = createSupabaseServiceRoleClient();
  } catch (error) {
    console.error(
      JSON.stringify({
        msg: "billing webhook failed",
        provider: provider.id,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return Response.json({ error: "billing webhook failed" }, { status: 500 });
  }

  const counts: Record<Outcome, number> = { applied: 0, duplicate: 0, ignored: 0, rejected: 0 };
  for (const delivery of deliveries) {
    try {
      const result = await applyBillingEvent(
        db,
        { provider: provider.id, providerEventId: delivery.id, event: delivery.event },
        systemClock,
      );
      counts[result.outcome] += 1;
      const level = result.outcome === "applied" || result.outcome === "duplicate" ? "log" : "warn";
      console[level](
        JSON.stringify({
          msg: "billing webhook delivery",
          provider: provider.id,
          eventId: delivery.id,
          type: delivery.event.type,
          outcome: result.outcome,
          ...(result.outcome === "ignored" || result.outcome === "rejected"
            ? { reason: result.reason }
            : {}),
        }),
      );
    } catch (error) {
      // Genuine processing failure: the ledger row (if written) keeps
      // processed_at null, so the provider's redelivery adopts it and
      // succeeds. 500 tells the provider to retry.
      console.error(
        JSON.stringify({
          msg: "billing webhook delivery failed",
          provider: provider.id,
          eventId: delivery.id,
          type: delivery.event.type,
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
      return Response.json({ error: "billing webhook failed" }, { status: 500 });
    }
  }

  return Response.json(
    {
      received: deliveries.length,
      provider: provider.id,
      applied: counts.applied,
      duplicates: counts.duplicate,
      ignored: counts.ignored,
      rejected: counts.rejected,
    },
    { status: 200, headers: NO_STORE },
  );
}

/**
 * Verify the signature (throws InvalidWebhookSignatureError on failure —
 * before any state change) and translate into deliveries carrying the
 * provider-native event ids. Providers that only implement parseWebhook get
 * deterministic synthetic ids derived from the event content, so an exact
 * redelivery still dedupes to the same key.
 */
async function verifyAndTranslate(
  provider: PaymentProvider,
  request: Request,
): Promise<WebhookDelivery[]> {
  if (provider.parseWebhookDeliveries) {
    return provider.parseWebhookDeliveries(request);
  }
  const events = await provider.parseWebhook(request);
  return events.map((event, index) => ({ id: syntheticEventId(event, index), event }));
}

/** Stable content key for adapters without native delivery ids (see above). */
function syntheticEventId(event: BillingEvent, index: number): string {
  return `synth_${fnv1a(JSON.stringify(event))}_${index}`;
}

/** FNV-1a 32-bit hex — sync and Workers-safe (no Node crypto, no subtle). */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
