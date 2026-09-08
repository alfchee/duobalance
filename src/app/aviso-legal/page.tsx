import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Aviso legal — contenido educativo — DuoBalance",
  description:
    "Aviso sobre el contenido educativo de DuoBalance: no es asesoría financiera y cuándo consultar a un profesional.",
  alternates: { canonical: "https://duobalanceapp.com/aviso-legal" },
};

export default function AvisoLegalPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver al inicio
      </Link>
      <article className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">Aviso legal — contenido educativo</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Vigente desde el 8 de septiembre de 2026.
        </p>
        <div className="rounded-2xl border bg-card p-5 sm:p-8 space-y-4 text-sm leading-relaxed">
          <p>
            DuoBalance no es un asesor financiero certificado. El contenido de la guía y las
            lecciones expone principios generales y ampliamente aceptados para organizar y entender
            tus gastos; no constituye asesoría financiera, legal ni fiscal.
          </p>
          <p>
            Cada hogar tiene circunstancias distintas. Para decisiones específicas sobre deudas,
            préstamos, inversiones, créditos, negocio o impuestos, consulta a un profesional
            calificado que pueda revisar tu situación particular y la normativa aplicable en tu
            país.
          </p>
          <p>
            Si identificas un error o una recomendación que no encaja con buenas prácticas locales,
            escríbenos a{" "}
            <a
              href="mailto:hola@duobalanceapp.com"
              className="font-semibold text-primary underline"
            >
              hola@duobalanceapp.com
            </a>
            .
          </p>
          <p className="text-xs text-muted-foreground">
            Este aviso aplica a todo el contenido en /guia y /guide, presente y futuro.
          </p>
        </div>
      </article>
    </main>
  );
}
