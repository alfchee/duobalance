"use client";

import Link from "next/link";
import { useLocale } from "next-intl";

const DISCLAIMER_ES =
  "DuoBalance no es asesor financiero certificado. Este contenido expone principios generales y ampliamente aceptados para organizar y entender tus gastos; no constituye asesoría financiera. Para decisiones específicas sobre deudas, préstamos, inversiones, negocio o impuestos, consulta a un profesional calificado que pueda revisar tu situación particular.";

const DISCLAIMER_EN =
  "DuoBalance is not a certified financial adviser. This content covers general, widely accepted principles for tracking and understanding your spending; it is not financial advice. For decisions about debt, loans, investments, business or taxes, talk to a qualified professional who can review your situation.";

const DISCLAIMER_PT =
  "O DuoBalance não é um consultor financeiro certificado. Este conteúdo apresenta princípios gerais e amplamente aceitos para organizar e entender seus gastos; não constitui aconselhamento financeiro. Para decisões específicas sobre dívidas, empréstimos, investimentos, negócios ou impostos, consulte um profissional qualificado.";

export function EducationalDisclaimer() {
  const locale = useLocale();
  let text = DISCLAIMER_ES;
  if (locale === "en") text = DISCLAIMER_EN;
  else if (locale === "pt-BR") text = DISCLAIMER_PT;

  const label =
    locale === "en"
      ? "Not financial advice"
      : locale === "pt-BR"
        ? "Não é aconselhamento financeiro"
        : "No es asesoría financiera";

  const linkLabel =
    locale === "en" ? "Learn more" : locale === "pt-BR" ? "Saiba mais" : "Saber más";

  return (
    <aside
      aria-label={label}
      className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <p className="text-xs font-bold uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-2">{text}</p>
      <p className="mt-3">
        <Link
          href="/aviso-legal"
          className="font-semibold underline underline-offset-2 hover:opacity-80"
        >
          {linkLabel}
        </Link>
      </p>
    </aside>
  );
}
