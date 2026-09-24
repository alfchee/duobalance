// Server-only: sending dunning (failed-payment) emails via Resend.
// Imported only from app/api/** route handlers and src/lib/cron/**.
// Pattern matches bill-reminder-email.ts.
//
// Tone (issue #265 AC: "Spanish copy is reviewed and does not shame the
// recipient"): these emails reach people whose card may have been declined
// because money is genuinely tight — the exact situation DuoBalance exists
// to help with. The copy therefore never uses "moroso", "deuda", "impago"
// or blame; it frames every stage as "tuvimos un problema con tu pago",
// reassures that household data is safe, and offers one clear next step.
// Mobile: single column, max-width 480px, system-ui, CTA padded for touch.

import { Resend } from "resend";
import type { DunningStage } from "@/lib/billing/dunning";

function getResendConfig() {
  return {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM ?? "DuoBalance <hola@duobalanceapp.com>",
    replyTo: process.env.RESEND_REPLY_TO,
  };
}

export class DunningEmailError extends Error {}

export type DunningEmailParams = {
  to: string[];
  stage: DunningStage;
  memberName: string;
  householdName: string;
  /** Absolute URL where the member can update the payment method. */
  manageUrl: string;
  /** Grace deadline ISO string; shown on the final notice only. */
  graceEndsOn?: string;
};

const SUBJECTS: Record<DunningStage, string> = {
  first_reminder: "Tuvimos un problema con tu pago de DuoBalance",
  second_reminder: "Recordatorio: tu pago de DuoBalance sigue pendiente",
  final_notice: "Último aviso: tu acceso a DuoBalance termina pronto",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shell(content: string): string {
  return `<div style="font-family: system-ui, sans-serif; line-height: 1.6; color: #111; max-width: 480px; margin: 0 auto; padding: 0 16px;">${content}</div>`;
}

function cta(url: string, label: string): string {
  return `<p style="margin: 24px 0;"><a href="${escapeHtml(url)}" style="display: inline-block; padding: 12px 24px; background: #0f766e; color: #fff; text-decoration: none; border-radius: 8px;">${escapeHtml(label)}</a></p>`;
}

function fallbackLink(url: string): string {
  return `<p style="color: #666; font-size: 14px;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p><p style="color: #666; font-size: 14px; word-break: break-all;">${escapeHtml(url)}</p>`;
}

function bodyFor(params: DunningEmailParams): { html: string; text: string } {
  const member = escapeHtml(params.memberName);
  const household = escapeHtml(params.householdName);
  switch (params.stage) {
    case "first_reminder": {
      const html = shell(
        `<p>Hola, ${member}</p>` +
          `<p>No pudimos procesar el pago de tu suscripción de <strong>${household}</strong> en DuoBalance. A veces es algo temporal — una tarjeta vencida o un límite del banco.</p>` +
          `<p>Tu información sigue a salvo y nada cambió en tu hogar. Para ponerte al día, revisa tu método de pago:</p>` +
          cta(params.manageUrl, "Revisar mi pago") +
          fallbackLink(params.manageUrl) +
          `<p style="color: #666; font-size: 14px;">Si ya lo actualizaste, ignora este mensaje.</p>`,
      );
      const text = `Hola, ${params.memberName}\n\nNo pudimos procesar el pago de tu suscripción de ${params.householdName} en DuoBalance. A veces es algo temporal — una tarjeta vencida o un límite del banco.\n\nTu información sigue a salvo y nada cambió en tu hogar. Para ponerte al día, revisa tu método de pago:\n${params.manageUrl}\n\nSi ya lo actualizaste, ignora este mensaje.`;
      return { html, text };
    }
    case "second_reminder": {
      const html = shell(
        `<p>Hola, ${member}</p>` +
          `<p>Te escribimos de nuevo porque el pago de tu suscripción de <strong>${household}</strong> sigue pendiente. Todavía tienes acceso a todo, y queremos que siga así.</p>` +
          `<p>¿Te ayudamos? Actualiza tu método de pago cuando puedas:</p>` +
          cta(params.manageUrl, "Actualizar mi pago") +
          fallbackLink(params.manageUrl) +
          `<p style="color: #666; font-size: 14px;">Si el dinero está justo este mes, lo entendemos — tu información seguirá guardada aunque la suscripción se pause.</p>`,
      );
      const text = `Hola, ${params.memberName}\n\nTe escribimos de nuevo porque el pago de tu suscripción de ${params.householdName} sigue pendiente. Todavía tienes acceso a todo, y queremos que siga así.\n\n¿Te ayudamos? Actualiza tu método de pago cuando puedas:\n${params.manageUrl}\n\nSi el dinero está justo este mes, lo entendemos — tu información seguirá guardada aunque la suscripción se pause.`;
      return { html, text };
    }
    case "final_notice": {
      const deadline = params.graceEndsOn ? ` (${params.graceEndsOn})` : "";
      const html = shell(
        `<p>Hola, ${member}</p>` +
          `<p>Este es el último aviso: si no logramos procesar tu pago antes del${escapeHtml(deadline)}, tu suscripción de <strong>${household}</strong> se pausará y perderás acceso temporalmente.</p>` +
          `<p>Queremos evitarlo. Solo toma un minuto:</p>` +
          cta(params.manageUrl, "Mantener mi acceso") +
          fallbackLink(params.manageUrl) +
          `<p style="color: #666; font-size: 14px;">Pase lo que pase, tus datos se conservan: cuando vuelvas, todo estará como lo dejaste. Y si prefieres cancelar, puedes hacerlo desde la misma página, sin preguntas incómodas.</p>`,
      );
      const text = `Hola, ${params.memberName}\n\nEste es el último aviso: si no logramos procesar tu pago antes del${params.graceEndsOn ? ` (${params.graceEndsOn})` : ""}, tu suscripción de ${params.householdName} se pausará y perderás acceso temporalmente.\n\nQueremos evitarlo. Solo toma un minuto:\n${params.manageUrl}\n\nPase lo que pase, tus datos se conservan: cuando vuelvas, todo estará como lo dejaste. Y si prefieres cancelar, puedes hacerlo desde la misma página, sin preguntas incómodas.`;
      return { html, text };
    }
  }
}

export async function sendDunningEmail(params: DunningEmailParams): Promise<void> {
  const { apiKey: RESEND_API_KEY, from: FROM, replyTo: REPLY_TO } = getResendConfig();
  if (!RESEND_API_KEY) {
    console.error("dunning-email: RESEND_API_KEY is not set — email not sent", {
      stage: params.stage,
      toCount: params.to.length,
      toDomains: [...new Set(params.to.map((e) => e.split("@")[1] ?? "unknown"))],
      householdName: params.householdName,
    });
    throw new DunningEmailError("RESEND_API_KEY is not set — dunning email not sent");
  }

  const subject = SUBJECTS[params.stage];
  const { html, text } = bodyFor(params);

  try {
    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM,
      to: params.to,
      subject,
      html,
      text,
      ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
    });

    if (error) {
      console.error("dunning-email: Resend delivery failed", {
        stage: params.stage,
        toCount: params.to.length,
        toDomains: [...new Set(params.to.map((e) => e.split("@")[1] ?? "unknown"))],
        householdName: params.householdName,
        error: error.message,
      });
      throw new DunningEmailError(`Resend failed: ${error.message}`);
    }

    console.info("dunning-email: dunning email sent", {
      stage: params.stage,
      toCount: params.to.length,
      toDomains: [...new Set(params.to.map((e) => e.split("@")[1] ?? "unknown"))],
      householdName: params.householdName,
    });
  } catch (err) {
    if (err instanceof DunningEmailError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.error("dunning-email: unexpected delivery error", {
      stage: params.stage,
      toCount: params.to.length,
      toDomains: [...new Set(params.to.map((e) => e.split("@")[1] ?? "unknown"))],
      error: message,
    });
    throw new DunningEmailError(`Resend failed: ${message}`);
  }
}
