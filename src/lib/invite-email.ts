// Server-only: sending invite emails via Resend. Imported only from
// app/api/** route handlers — it reads the RESEND_API_KEY / APP_URL server
// env vars, so it must never be bundled for the client. APP_URL builds the
// accept link in the email; the token stays out of every log and API body.

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.APP_URL;
const FROM = process.env.RESEND_FROM ?? "DuoBalance <hola@duobalance.app>";
const REPLY_TO = process.env.RESEND_REPLY_TO;

export class InviteEmailError extends Error {}

type InviteEmailParams = {
  to: string;
  inviterName: string;
  householdName: string;
  token: string;
  locale: string;
};

const SUBJECTS: Record<string, string> = {
  es: "{inviterName} te invitó a {householdName}",
  en: "{inviterName} invited you to {householdName}",
};

const BODY: Record<
  string,
  (p: Omit<InviteEmailParams, "token" | "to">) => { html: string; text: string }
> = {
  es: ({ inviterName, householdName }) => ({
    html: `
      <div style="font-family: system-ui, sans-serif; line-height: 1.6; color: #111; max-width: 480px; margin: 0 auto;">
        <p>Hola,</p>
        <p>${escapeHtml(inviterName)} te invitó a unirse al hogar <strong>${escapeHtml(householdName)}</strong> en DuoBalance.</p>
        <p>Para aceptar la invitación, abre el siguiente enlace:</p>
        <p style="margin: 24px 0;">
          <a href="{acceptUrl}" style="display: inline-block; padding: 12px 24px; background: #0f766e; color: #fff; text-decoration: none; border-radius: 8px;">Aceptar invitación</a>
        </p>
        <p style="color: #666; font-size: 14px;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
        <p style="color: #666; font-size: 14px; word-break: break-all;">{acceptUrl}</p>
      </div>
    `,
    text: `${inviterName} te invitó a unirse al hogar ${householdName} en DuoBalance.\n\nAcepta la invitación abriendo este enlace:\n{acceptUrl}`,
  }),
  en: ({ inviterName, householdName }) => ({
    html: `
      <div style="font-family: system-ui, sans-serif; line-height: 1.6; color: #111; max-width: 480px; margin: 0 auto;">
        <p>Hi,</p>
        <p>${escapeHtml(inviterName)} invited you to join the household <strong>${escapeHtml(householdName)}</strong> on DuoBalance.</p>
        <p>To accept the invitation, open the link below:</p>
        <p style="margin: 24px 0;">
          <a href="{acceptUrl}" style="display: inline-block; padding: 12px 24px; background: #0f766e; color: #fff; text-decoration: none; border-radius: 8px;">Accept invitation</a>
        </p>
        <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="color: #666; font-size: 14px; word-break: break-all;">{acceptUrl}</p>
      </div>
    `,
    text: `${inviterName} invited you to join the household ${householdName} on DuoBalance.\n\nAccept the invitation by opening this link:\n{acceptUrl}`,
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

// A new Resend client is created per send — the API key is a server secret
// and the client is stateless, so there's nothing worth caching.
export async function sendInviteEmail(params: InviteEmailParams): Promise<void> {
  if (!RESEND_API_KEY) {
    throw new InviteEmailError("RESEND_API_KEY is not set — invite email not sent");
  }
  if (!APP_URL) {
    throw new InviteEmailError("APP_URL is not set — cannot build the accept link");
  }

  const locale = params.locale in BODY ? params.locale : "en";
  const subject = (SUBJECTS[locale] ?? (SUBJECTS.en as string))
    .replaceAll("{inviterName}", params.inviterName)
    .replaceAll("{householdName}", params.householdName);

  const { html, text } = BODY[locale]!(params);

  const acceptUrl = `${APP_URL.replace(/\/+$/, "")}/accept-invite/${params.token}`;
  const htmlBody = html.replaceAll("{acceptUrl}", acceptUrl);
  const textBody = text.replaceAll("{acceptUrl}", acceptUrl);

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
    throw new InviteEmailError(`Resend failed: ${error.message}`);
  }
}
