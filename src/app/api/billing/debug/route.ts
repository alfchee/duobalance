import { createRouteContext, getAuthedUser, HttpError } from "@/app/api/_shared";
import { createMoney } from "@/lib/billing/money";
import { getStubForDebug } from "@/lib/billing/registry";
import { z } from "zod";

// POST /api/billing/debug — admin-only manual controls for the stub provider
// (issue #259). POST-only on purpose: with no GET handler there is nothing
// to prerender, so the Tauri static-export build skips this route entirely
// (same precedent as push-subscriptions).
//
// Reachability, in order:
//   1. Production → 404 (the route does not exist there; the acceptance
//      criterion). Checked before auth so existence never leaks.
//   2. Tauri webview builds → 404 (no server at runtime).
//   3. Everywhere else → the caller must be authenticated. There is no admin
//      role in the app yet (#271 builds the admin app); until then any signed-in
//      user in a non-production build may drive the sandbox. The sandbox
//      instance is separate from the registry's system-clocked stub, so
//      manual driving can never touch real provider state.

const statusSchema = z.object({ action: z.literal("status") });

const checkoutSchema = z.object({
  action: z.literal("checkout"),
  householdId: z.string().min(1),
  planCode: z.string().min(1),
});

const refSchema = z.object({ ref: z.string().min(1) });

const advanceSchema = z.object({
  action: z.literal("advance"),
  status: z.enum(["trialing", "active", "past_due", "grace", "cancelled", "expired"]),
});

const renewalSchema = z.object({
  action: z.enum(["succeed-renewal", "fail-renewal", "reactivate", "cancel"]),
});

const redeliverSchema = z.object({
  action: z.literal("redeliver"),
  eventId: z.string().min(1),
});

const moneyJsonSchema = z.object({
  amount: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const dateSchema = z.string().datetime({ offset: true });

const billingEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscription.activated"),
    ref: z.string().min(1),
    planCode: z.string().min(1),
    periodEnd: dateSchema,
  }),
  z.object({
    type: z.literal("payment.succeeded"),
    ref: z.string().min(1),
    amount: moneyJsonSchema,
    periodEnd: dateSchema,
  }),
  z.object({
    type: z.literal("payment.failed"),
    ref: z.string().min(1),
    attempt: z.number().int().min(1),
  }),
  z.object({
    type: z.literal("subscription.cancelled"),
    ref: z.string().min(1),
    effectiveAt: dateSchema,
  }),
  z.object({ type: z.literal("subscription.expired"), ref: z.string().min(1) }),
]);

const injectSchema = z.object({
  action: z.literal("inject"),
  events: z.array(billingEventSchema).min(1).max(25),
});

const advanceTimeSchema = z.object({
  action: z.literal("advance-time"),
  ms: z
    .number()
    .int()
    .min(0)
    .max(366 * 24 * 60 * 60 * 1000),
});

const resetSchema = z.object({ action: z.literal("reset") });

const bodySchema = z.discriminatedUnion("action", [
  statusSchema,
  checkoutSchema,
  advanceSchema.merge(refSchema),
  renewalSchema.merge(refSchema),
  redeliverSchema,
  injectSchema,
  advanceTimeSchema,
  resetSchema,
]);

type Body = z.infer<typeof bodySchema>;

// Module-scoped counter: the debug sandbox is deterministic (fixed-start
// manual clock), so idempotency keys come from a counter, never wall-clock.
let debugCheckoutCount = 0;

function toEvent(input: z.infer<typeof billingEventSchema>) {
  switch (input.type) {
    case "subscription.activated":
      return {
        type: input.type,
        ref: input.ref,
        planCode: input.planCode,
        periodEnd: new Date(input.periodEnd),
      } as const;
    case "payment.succeeded":
      // Canonical Money validation lives in the domain (moneySchema rejects
      // non-ISO codes like ABC); failures surface as the route's 422 below.
      return {
        type: input.type,
        ref: input.ref,
        amount: createMoney(input.amount.amount, input.amount.currency),
        periodEnd: new Date(input.periodEnd),
      } as const;
    case "payment.failed":
      return { type: input.type, ref: input.ref, attempt: input.attempt } as const;
    case "subscription.cancelled":
      return {
        type: input.type,
        ref: input.ref,
        effectiveAt: new Date(input.effectiveAt),
      } as const;
    case "subscription.expired":
      return { type: input.type, ref: input.ref } as const;
  }
}

async function handle(body: Body) {
  const stub = getStubForDebug();
  switch (body.action) {
    case "status":
      return {
        now: stub.now().toISOString(),
        subscriptions: stub.listSubscriptions().map((sub) => ({
          ...sub,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        })),
        outboxSize: stub.getOutboxSize(),
        events: stub.getEventLog().map((entry) => ({ id: entry.id, type: entry.event.type })),
      };
    case "checkout":
      debugCheckoutCount += 1;
      return stub.createCheckout({
        householdId: body.householdId,
        planCode: body.planCode,
        idempotencyKey: `debug-${debugCheckoutCount}`,
      });
    case "advance":
      return stub.advanceTo(body.ref, body.status);
    case "succeed-renewal":
      return stub.simulateSuccessfulRenewal(body.ref);
    case "fail-renewal":
      return stub.simulateFailedRenewal(body.ref);
    case "reactivate":
      return stub.reactivate(body.ref);
    case "cancel":
      await stub.cancelSubscription({ subscriptionRef: body.ref });
      return { ok: true };
    case "redeliver": {
      const entry = stub.redeliverEvent(body.eventId);
      return { id: entry.id, type: entry.event.type, outboxSize: stub.getOutboxSize() };
    }
    case "inject":
      return stub.injectEvents(body.events.map(toEvent));
    case "advance-time":
      return { now: stub.advanceTime(body.ms).toISOString() };
    case "reset":
      stub.reset();
      return { ok: true };
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (process.env.BUILD_TARGET === "tauri") {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const supabase = await createRouteContext();
  try {
    await getAuthedUser(supabase);
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: "authentication required" }, { status: error.status });
    }
    throw error;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid action" }, { status: 400 });
  }
  try {
    const result = await handle(parsed.data);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "debug action failed" },
      { status: 422 },
    );
  }
}
