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
  let userId: string | undefined;
  let supabase: Awaited<ReturnType<typeof createSupabaseRouteHandler>> | undefined;
  try {
    supabase = await createSupabaseRouteHandler();
    const { data } = await supabase.auth.getUser();
    if (data.user?.email && data.user.id) {
      userEmail = data.user.email;
      userId = data.user.id;
      if (!canSubmitFeedback(data.user.id, Date.now())) {
        return Response.json({ error: "too many feedback submissions" }, { status: 429 });
      }
    }
  } catch {
    return Response.json({ error: "authentication required" }, { status: 401 });
  }

  if (!userEmail || !userId || !supabase) {
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

  // Persist alongside email — keep email path unchanged. Validate household/member against service_role bypass.
  const rawHouseholdId =
    diagnostics.householdId !== "none" && diagnostics.householdId ? diagnostics.householdId : null;
  const rawMemberId =
    diagnostics.memberId !== "none" && diagnostics.memberId ? diagnostics.memberId : null;
  // Zod already validates uuid vs "none", but keep a defensive check for service_role bypass.
  const isUuid = (v: string | null) =>
    v !== null &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
  const persistHouseholdId: string | null =
    rawHouseholdId && isUuid(rawHouseholdId) ? rawHouseholdId : null;
  const persistMemberId: string | null = rawMemberId && isUuid(rawMemberId) ? rawMemberId : null;

  // Run DB persist and email in parallel — don't let DB latency block email, and don't fail email if DB fails.
  // Explicit membership checks — service_role bypasses RLS, so we must enforce here.
  const insertPromise = (async () => {
    let finalHouseholdId: string | null = persistHouseholdId;
    let finalMemberId: string | null = persistMemberId;
    try {
      if (finalHouseholdId) {
        const { data: membership, error: membershipError } = await supabase
          .from("household_members")
          .select("id")
          .eq("household_id", finalHouseholdId)
          .eq("user_id", userId)
          .is("removed_at", null)
          .maybeSingle();
        if (membershipError) {
          console.warn("Feedback household lookup failed — dropping household_id", {
            persistHouseholdId: finalHouseholdId,
            userId,
            error: membershipError,
          });
          finalHouseholdId = null;
          finalMemberId = null;
        } else if (!membership) {
          console.warn("Feedback household mismatch — dropping household_id", {
            persistHouseholdId: finalHouseholdId,
            userId,
          });
          finalHouseholdId = null;
          finalMemberId = null;
        } else if (finalMemberId) {
          const { data: member, error: memberError } = await supabase
            .from("household_members")
            .select("id, household_id, user_id")
            .eq("id", finalMemberId)
            .maybeSingle();
          if (memberError) {
            console.warn("Feedback member lookup failed — dropping member_id", {
              persistMemberId: finalMemberId,
              persistHouseholdId: finalHouseholdId,
              error: memberError,
            });
            finalMemberId = null;
          } else if (
            !member ||
            member.household_id !== finalHouseholdId ||
            member.user_id !== userId
          ) {
            console.warn("Feedback member mismatch — dropping member_id", {
              persistMemberId: finalMemberId,
              persistHouseholdId: finalHouseholdId,
            });
            finalMemberId = null;
          }
        }
      } else if (finalMemberId) {
        const { data: member, error: memberError } = await supabase
          .from("household_members")
          .select("id, user_id")
          .eq("id", finalMemberId)
          .maybeSingle();
        if (memberError) {
          console.warn("Feedback member lookup failed — dropping member_id", {
            persistMemberId: finalMemberId,
            error: memberError,
          });
          finalMemberId = null;
        } else if (!member || member.user_id !== userId) {
          finalMemberId = null;
        }
      }
      const { error: insertError } = await supabase.from("feedback_submissions").insert({
        household_id: finalHouseholdId,
        user_id: userId,
        member_id: finalMemberId,
        category,
        message: message ?? "",
        diagnostics: normalizedDiagnostics as unknown as Record<string, never>,
      });
      if (insertError) console.error("Feedback DB persist error:", insertError);
    } catch (persistError) {
      console.error("Feedback DB persist error:", persistError);
    }
  })();

  const emailPromise = sendFeedbackEmail({
    category,
    message,
    diagnostics: normalizedDiagnostics,
    userEmail,
  });

  const [, emailResult] = await Promise.allSettled([insertPromise, emailPromise]);

  if (emailResult.status === "rejected") {
    console.error("Feedback route error:", emailResult.reason);
    return Response.json({ error: "failed to send feedback" }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
