import { Resend } from "resend";
import type { DiagnosticContext } from "@/lib/diagnostics";

export class FeedbackEmailError extends Error {}

export type SendFeedbackEmailParams = {
  category: "problem_report" | "satisfaction_prompt" | "general";
  message: string;
  diagnostics: DiagnosticContext;
  userEmail?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendFeedbackEmail(params: SendFeedbackEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? "DuoBalance <hola@duobalance.app>";
  const recipient =
    process.env.FEEDBACK_RECIPIENT_EMAIL ?? process.env.RESEND_REPLY_TO ?? "hola@duobalance.app";

  if (!apiKey) {
    throw new FeedbackEmailError("RESEND_API_KEY is not set — feedback email not sent");
  }

  const householdId = params.diagnostics.householdId || "none";
  const categoryLabel =
    params.category === "problem_report"
      ? "Problem Report"
      : params.category === "satisfaction_prompt"
        ? "2-Week Prompt Feedback"
        : "General Feedback";

  const subject = `[DuoBalance Feedback] Household: ${householdId} - ${categoryLabel}`;

  const formattedDiagnostics = JSON.stringify(params.diagnostics, null, 2);

  const htmlBody = `
    <div style="font-family: system-ui, sans-serif; line-height: 1.6; color: #111; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #0f766e; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">DuoBalance ${categoryLabel}</h2>
      <p><strong>From User:</strong> ${params.userEmail ? escapeHtml(params.userEmail) : "Anonymous"}</p>
      <p><strong>Household ID:</strong> <code>${escapeHtml(householdId)}</code></p>
      <p><strong>Category:</strong> ${escapeHtml(categoryLabel)}</p>
      
      <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <h3 style="margin-top: 0;">Message:</h3>
        <p style="white-space: pre-wrap;">${escapeHtml(params.message || "(No text message provided)")}</p>
      </div>

      <div style="background-color: #f3f4f6; border: 1px solid #d1d5db; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <h3 style="margin-top: 0;">Diagnostic Context:</h3>
        <pre style="font-size: 12px; font-family: monospace; overflow-x: auto; white-space: pre-wrap;">${escapeHtml(formattedDiagnostics)}</pre>
      </div>
    </div>
  `;

  const textBody =
    `DuoBalance ${categoryLabel}\n` +
    `From User: ${params.userEmail ?? "Anonymous"}\n` +
    `Household ID: ${householdId}\n\n` +
    `Message:\n${params.message || "(No message provided)"}\n\n` +
    `Diagnostic Context:\n${formattedDiagnostics}\n`;

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: recipient,
    subject,
    html: htmlBody,
    text: textBody,
    ...(params.userEmail ? { replyTo: params.userEmail } : {}),
  });

  if (error) {
    throw new FeedbackEmailError(`Resend failed: ${error.message}`);
  }
}
