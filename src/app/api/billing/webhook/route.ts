import { systemClock } from "@/lib/billing/clock";
import { isBillingEnabled } from "@/lib/billing/enabled";
import { applyBillingEvent } from "@/lib/billing/lifecycle";
import {
  InvalidWebhookSignatureError,
  type BillingEvent,
  type PaymentProvider,
  type WebhookDelivery,
} from "@/lib/billing/provider";
import { getActiveProvider } from "@/lib/billing/registry";
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
//   throw from applyBillingEvent (DB failure, write-write race,
//     ConcurrentModificationError) → 500 so the provider retries;
//     processed_at stays null so the retry succeeds. Deliberately 500 rather
//     than the 409/503 suggested in lifecycle.ts: for provider webhooks 500
//     is the universal "retry me" signal.
//   UnknownProviderError / client construction → 500 (misconfigured server)
//
// A failed delivery does NOT abort the batch: the remaining deliveries are
// still applied, and the response is 500 with the counts. Providers retry
// the whole HTTP body, and idempotency turns the already-applied prefix
// into duplicates on the replay while the failed delivery is re-attempted.
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

  // getActiveProvider is the only UnknownProviderError thrower, so it gets
  // its own try: the verification try below then needs no dead branch for it.
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
  let failed = 0;
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
      // succeeds. Count and continue — the 500 below tells the provider to
      // retry the whole body, and idempotency turns the applied prefix into
      // duplicates on the replay.
      failed += 1;
      console.error(
        JSON.stringify({
          msg: "billing webhook delivery failed",
          provider: provider.id,
          eventId: delivery.id,
          type: delivery.event.type,
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
  }

  const summary = {
    received: deliveries.length,
    provider: provider.id,
    applied: counts.applied,
    duplicate: counts.duplicate,
    ignored: counts.ignored,
    rejected: counts.rejected,
    failed,
  };
  if (failed > 0) {
    return Response.json(
      { error: "billing webhook failed", ...summary },
      { status: 500, headers: NO_STORE },
    );
  }
  return Response.json(summary, { status: 200, headers: NO_STORE });
}

/**
 * Verify the signature (throws InvalidWebhookSignatureError on failure —
 * before any state change) and translate into deliveries carrying the
 * provider-native event ids. Providers that only implement parseWebhook get
 * deterministic synthetic ids derived from the event CONTENT alone — no
 * batch index — so a redelivery dedupes however the provider reshapes the
 * batch (full-body retry, per-event retry, or a different arrival order).
 * The trade-off is explicit: byte-identical twins inside one batch collapse
 * to a single application, which is the safe idempotent choice for
 * indistinguishable deliveries.
 */
async function verifyAndTranslate(
  provider: PaymentProvider,
  request: Request,
): Promise<WebhookDelivery[]> {
  if (provider.parseWebhookDeliveries) {
    return provider.parseWebhookDeliveries(request);
  }
  const events = await provider.parseWebhook(request);
  return events.map((event) => ({ id: syntheticEventId(event), event }));
}

/** Stable content key for adapters without native delivery ids (see above). */
function syntheticEventId(event: BillingEvent): string {
  return `synth_${fnv1a64(stableStringify(event))}`;
}

/**
 * Canonical JSON with sorted object keys: the same logical event hashes the
 * same way regardless of key order, so reshaped redeliveries dedupe instead
 * of double-applying. Dates serialize as ISO strings (matching JSON).
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * FNV-1a 64-bit hex (16 chars) — sync and Workers-safe (BigInt only, no Node
 * crypto, no subtle). 64 bits over the canonical form: key-order stable and
 * far less collision-prone than the previous 32-bit hash of raw JSON.
 */
function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
