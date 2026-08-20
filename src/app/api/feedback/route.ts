import { z } from "zod";
import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { assertNoFinancialData } from "@/lib/diagnostics";
import { sendFeedbackEmail } from "@/lib/feedback-email";

const feedbackSchema = z.object({
  category: z.enum(["problem_report", "satisfaction_prompt", "general"]).default("problem_report"),
  message: z.string().default(""),
  diagnostics: z.object({
    appVersion: z.string(),
    householdId: z.string(),
    memberId: z.string(),
    role: z.enum(["owner", "partner"]),
    locale: z.string(),
    numberFormat: z.string(),
    baseCurrency: z.string(),
    timezone: z.string(),
    accountCount: z.number(),
    transactionCount: z.number(),
    isStandalone: z.boolean(),
    isOnline: z.boolean(),
    queuedWrites: z.number(),
    userAgent: z.string(),
    lastError: z
      .object({
        message: z.string(),
        stack: z.string().optional(),
        at: z.string(),
      })
      .nullable()
      .optional(),
    currentRoute: z.string(),
  }),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid feedback payload" }, { status: 400 });
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

  try {
    await sendFeedbackEmail({
      category,
      message,
      diagnostics,
      userEmail,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Feedback route error:", error);
    return Response.json({ error: "failed to send feedback" }, { status: 500 });
  }
}
