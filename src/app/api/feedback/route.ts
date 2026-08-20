import { z } from "zod";
import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { assertNoFinancialData, type DiagnosticContext } from "@/lib/diagnostics";
import { sendFeedbackEmail } from "@/lib/feedback-email";

const feedbackSchema = z.object({
  category: z.string().optional().default("problem_report"),
  message: z.string().optional().default(""),
  diagnostics: z
    .object({
      appVersion: z.string().optional().default("1.1.0"),
      householdId: z.string().optional().default("none"),
      memberId: z.string().optional().default("none"),
      role: z.string().optional().default("owner"),
      locale: z.string().optional().default("en"),
      numberFormat: z.string().optional().default("locale"),
      baseCurrency: z.string().optional().default("USD"),
      timezone: z.string().optional().default("UTC"),
      accountCount: z.number().optional().default(0),
      transactionCount: z.number().optional().default(0),
      isStandalone: z.boolean().optional().default(false),
      isOnline: z.boolean().optional().default(true),
      queuedWrites: z.number().optional().default(0),
      userAgent: z.string().optional().default(""),
      lastError: z
        .object({
          message: z.string().optional(),
          stack: z.string().optional().nullable(),
          at: z.string().optional(),
        })
        .nullable()
        .optional(),
      currentRoute: z.string().optional().default("/"),
    })
    .passthrough(),
});

export async function POST(request: Request) {
  let body = await request.json().catch(() => null);
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email) {
      userEmail = user.email;
    }
  } catch {
    // Session optional for feedback reporting
  }

  const normalizedCategory =
    category === "satisfaction_prompt" || category === "general" ? category : "problem_report";

  const normalizedRole = diagnostics.role === "partner" ? "partner" : "owner";

  const normalizedDiagnostics: DiagnosticContext = {
    ...diagnostics,
    role: normalizedRole,
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
      category: normalizedCategory,
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
