// Server-only: sending bill reminder emails via Resend.
// Imported only from app/api/** route handlers.
// Pattern matches invite-email.ts.

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM ?? "duobalance <reminders@resend.dev>";

export class ReminderEmailError extends Error {}

export type ReminderItem = {
  billName: string;
  dueOn: string; // ISO date string
  amount: number;
  currency: string;
};

export type ReminderDigestParams = {
  to: string[];
  memberName: string;
  householdName: string;
  items: ReminderItem[];
  locale: string;
};

const SUBJECTS: Record<string, string> = {
  es: "Tienes {count} factura(s) por pagar en {householdName}",
  en: "You have {count} bill(s) due in {householdName}",
};

const DIGEST_BODY: Record<
  string,
  (p: { memberName: string; householdName: string; items: ReminderItem[]; locale: string }) => {
    html: string;
    text: string;
  }
> = {
  es: ({ memberName, householdName, items }) => {
    const lines = items
      .map(
        (i) =>
          `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(i.billName)}</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${escapeHtml(i.currency)} ${formatAmount(i.amount, i.currency, "es")}</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${i.dueOn}</td></tr>`,
      )
      .join("\n");
    return {
      html: `
<div style="font-family: system-ui, sans-serif; line-height: 1.6; color: #111; max-width: 480px; margin: 0 auto;">
  <p>Hola, ${escapeHtml(memberName)}</p>
  <p>Tienes las siguientes facturas por pagar en <strong>${escapeHtml(householdName)}</strong>:</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <thead><tr><th style="text-align: left; padding: 8px 0; border-bottom: 2px solid #ddd;">Factura</th><th style="text-align: right; padding: 8px 0; border-bottom: 2px solid #ddd;">Monto</th><th style="text-align: right; padding: 8px 0; border-bottom: 2px solid #ddd;">Vence</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <p style="color: #666; font-size: 14px;">Paga desde la aplicación para mantener tus finanzas al día.</p>
</div>`,
      text: `Hola, ${memberName}\n\nTienes las siguientes facturas por pagar en ${householdName}:\n${items.map((i) => `- ${i.billName}: ${i.currency} ${i.amount} (vence ${i.dueOn})`).join("\n")}\n\nPaga desde la aplicación para mantener tus finanzas al día.`,
    };
  },
  en: ({ memberName, householdName, items }) => {
    const lines = items
      .map(
        (i) =>
          `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escapeHtml(i.billName)}</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${escapeHtml(i.currency)} ${formatAmount(i.amount, i.currency, "en")}</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${i.dueOn}</td></tr>`,
      )
      .join("\n");
    return {
      html: `
<div style="font-family: system-ui, sans-serif; line-height: 1.6; color: #111; max-width: 480px; margin: 0 auto;">
  <p>Hi, ${escapeHtml(memberName)}</p>
  <p>You have the following bills due in <strong>${escapeHtml(householdName)}</strong>:</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <thead><tr><th style="text-align: left; padding: 8px 0; border-bottom: 2px solid #ddd;">Bill</th><th style="text-align: right; padding: 8px 0; border-bottom: 2px solid #ddd;">Amount</th><th style="text-align: right; padding: 8px 0; border-bottom: 2px solid #ddd;">Due</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <p style="color: #666; font-size: 14px;">Pay from the app to keep your finances on track.</p>
</div>`,
      text: `Hi, ${memberName}\n\nYou have the following bills due in ${householdName}:\n${items.map((i) => `- ${i.billName}: ${i.currency} ${i.amount} (due ${i.dueOn})`).join("\n")}\n\nPay from the app to keep your finances on track.`,
    };
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatAmount(amount: number, _currency: string, _locale: string): string {
  // Simple formatting for email — uses fixed 2 decimals for display.
  // The amounts are already stored in minor-unit-compatible form.
  return amount.toLocaleString(_locale === "es" ? "es-CL" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export async function sendReminderDigest(params: ReminderDigestParams): Promise<void> {
  if (!RESEND_API_KEY) {
    throw new ReminderEmailError("RESEND_API_KEY is not set — reminder email not sent");
  }

  const locale = params.locale in DIGEST_BODY ? params.locale : "en";
  const subject = (SUBJECTS[locale] ?? (SUBJECTS.en as string))
    .replaceAll("{count}", String(params.items.length))
    .replaceAll("{householdName}", params.householdName);

  const { html, text } = DIGEST_BODY[locale]!(params);

  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    subject,
    html,
    text,
  });

  if (error) {
    throw new ReminderEmailError(`Resend failed: ${error.message}`);
  }
}
