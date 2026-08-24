import { z } from "zod";
import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { assertNoFinancialData, type DiagnosticContext } from "@/lib/diagnostics";
import { sendFeedbackEmail } from "@/lib/feedback-email";

const feedbackSchema = z
  .object({
    category: z
      .enum(["problem_report", "satisfaction_prompt", "general"])
      .optional()
      .default("problem_report"),
    message: z.string().max(4_000).optional().default(""),
    diagnostics: z
      .object({
        appVersion: z.string().max(100).optional().default("1.1.0"),
        householdId: z
          .union([z.string().uuid(), z.literal("none")])
          .optional()
          .default("none"),
        memberId: z
          .union([z.string().uuid(), z.literal("none")])
          .optional()
          .default("none"),
        role: z.enum(["owner", "partner"]).optional().default("owner"),
        locale: z.string().max(35).optional().default("en"),
        numberFormat: z.string().max(35).optional().default("locale"),
        baseCurrency: z.string().length(3).optional().default("USD"),
        timezone: z.string().max(100).optional().default("UTC"),
        accountCount: z.number().optional().default(0),
        transactionCount: z.number().optional().default(0),
        isStandalone: z.boolean().optional().default(false),
        isOnline: z.boolean().optional().default(true),
        queuedWrites: z.number().optional().default(0),
        userAgent: z.string().max(1_000).optional().default(""),
        lastError: z
          .object({
            message: z.string().max(1_000).optional(),
            stack: z.string().max(8_000).optional().nullable(),
            at: z.string().datetime().optional(),
          })
          .nullable()
          .optional(),
        currentRoute: z.string().max(500).optional().default("/"),
      })
      .strict(),
  })
  .strict();

const feedbackAttempts = new Map<string, number[]>();
const feedbackWindowMs = 10 * 60 * 1_000;
const maxFeedbackAttempts = 5;

function canSubmitFeedback(userId: string, now: number): boolean {
  const recentAttempts = (feedbackAttempts.get(userId) ?? []).filter(
    (attemptedAt) => now - attemptedAt < feedbackWindowMs,
  );
  if (recentAttempts.length >= maxFeedbackAttempts) {
    feedbackAttempts.set(userId, recentAttempts);
    return false;
  }
  feedbackAttempts.set(userId, [...recentAttempts, now]);
  return true;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > 16_384) {
    return Response.json({ error: "feedback payload is too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      // Keep string if invalid JSON
    }
  }
  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    console.error("Feedback Zod validation error:", parsed.error);
    return Response.json(
      { error: "invalid feedback payload", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { category, message, diagnostics } = parsed.data;

  try {
    assertNoFinancialData(diagnostics as unknown as Record<string, unknown>);
  } catch {
    return Response.json({ error: "financial data is not permitted" }, { status: 400 });
  }

  let userEmail: string | undefined;
  try {
    const supabase = await createSupabaseRouteHandler();
    const { data } = await supabase.auth.getUser();
    if (data.user?.email && data.user.id) {
      userEmail = data.user.email;
      if (!canSubmitFeedback(data.user.id, Date.now())) {
        return Response.json({ error: "too many feedback submissions" }, { status: 429 });
      }
    }
  } catch {
    return Response.json({ error: "authentication required" }, { status: 401 });
  }

  if (!userEmail) {
    return Response.json({ error: "authentication required" }, { status: 401 });
  }

  const normalizedDiagnostics: DiagnosticContext = {
    ...diagnostics,
    role: diagnostics.role,
    lastError: diagnostics.lastError
      ? {
          message: diagnostics.lastError.message ?? "",
          stack: diagnostics.lastError.stack ?? undefined,
          at: diagnostics.lastError.at ?? new Date().toISOString(),
        }
      : undefined,
  };

  try {
    await sendFeedbackEmail({
      category,
      message,
      diagnostics: normalizedDiagnostics,
      userEmail,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Feedback route error:", error);
    return Response.json({ error: "failed to send feedback" }, { status: 500 });
  }
}
