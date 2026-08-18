// Server-only: sending member removal emails via Resend.
// Imported only from app/api/** route handlers.
// Pattern matches invite-email.ts.

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.APP_URL;
const FROM = process.env.RESEND_FROM ?? "DuoBalance <hola@duobalance.app>";
const REPLY_TO = process.env.RESEND_REPLY_TO;

export class MemberRemovalEmailError extends Error {}

const SUPPORTED_EMAIL_LOCALES = ["es", "en"] as const;
export type MemberRemovalEmailLocale = (typeof SUPPORTED_EMAIL_LOCALES)[number];

export function isSupportedEmailLocale(
  value: string | null | undefined,
): value is MemberRemovalEmailLocale {
  return (SUPPORTED_EMAIL_LOCALES as readonly string[]).includes(value ?? "");
}

export type MemberRemovalEmailParams = {
  to: string;
  memberName: string;
  householdName: string;
  householdId: string;
  locale: MemberRemovalEmailLocale;
};

const SUBJECTS: Record<MemberRemovalEmailLocale, string> = {
  es: "Has sido removido del hogar {householdName}",
  en: "You have been removed from {householdName}",
};

const BODY: Record<
  MemberRemovalEmailLocale,
  (p: Omit<MemberRemovalEmailParams, "to">) => { html: string; text: string }
> = {
  es: ({ memberName, householdName }) => ({
    html: `
      <div style="font-family: system-ui, sans-serif; line-height: 1.6; color: #111; max-width: 480px; margin: 0 auto;">
        <p>Hola ${escapeHtml(memberName)},</p>
        <p>Has sido removido del hogar <strong>${escapeHtml(householdName)}</strong> en DuoBalance.</p>
        <p>Tus datos personales y registros pasados se mantienen intactos. Puedes descargar una copia de tus datos usando el siguiente enlace:</p>
        <p style="margin: 24px 0;">
          <a href="{exportUrl}" style="display: inline-block; padding: 12px 24px; background: #0f766e; color: #fff; text-decoration: none; border-radius: 8px;">Exportar tus datos</a>
        </p>
        <p style="color: #666; font-size: 14px;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
        <p style="color: #666; font-size: 14px; word-break: break-all;">{exportUrl}</p>
      </div>
    `,
    text: `Hola ${memberName},\n\nHas sido removido del hogar ${householdName} en DuoBalance.\n\nPuedes exportar tus datos desde este enlace:\n{exportUrl}`,
  }),
  en: ({ memberName, householdName }) => ({
    html: `
      <div style="font-family: system-ui, sans-serif; line-height: 1.6; color: #111; max-width: 480px; margin: 0 auto;">
        <p>Hi ${escapeHtml(memberName)},</p>
        <p>You have been removed from the household <strong>${escapeHtml(householdName)}</strong> on DuoBalance.</p>
        <p>Your personal data and past records are intact. You can download a copy of your data using the link below:</p>
        <p style="margin: 24px 0;">
          <a href="{exportUrl}" style="display: inline-block; padding: 12px 24px; background: #0f766e; color: #fff; text-decoration: none; border-radius: 8px;">Export your data</a>
        </p>
        <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="color: #666; font-size: 14px; word-break: break-all;">{exportUrl}</p>
      </div>
    `,
    text: `Hi ${memberName},\n\nYou have been removed from the household ${householdName} on DuoBalance.\n\nYou can export your data using this link:\n{exportUrl}`,
  }),
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendMemberRemovalEmail(params: MemberRemovalEmailParams): Promise<void> {
  if (!RESEND_API_KEY) {
    throw new MemberRemovalEmailError("RESEND_API_KEY is not set — removal email not sent");
  }
  if (!APP_URL) {
    throw new MemberRemovalEmailError("APP_URL is not set — cannot build export link");
  }

  const subject = SUBJECTS[params.locale].replaceAll("{householdName}", params.householdName);

  const { html, text } = BODY[params.locale](params);

  const exportUrl = `${APP_URL.replace(/\/+$/, "")}/api/export?format=json&householdId=${params.householdId}`;
  const htmlBody = html.replaceAll("{exportUrl}", exportUrl);
  const textBody = text.replaceAll("{exportUrl}", exportUrl);

  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    subject,
    html: htmlBody,
    text: textBody,
    ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
  });

  if (error) {
    throw new MemberRemovalEmailError(`Resend failed: ${error.message}`);
  }
}
