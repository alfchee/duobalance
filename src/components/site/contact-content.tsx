"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Globe, Mail, MessageSquareText } from "lucide-react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicFooter } from "@/components/site/public-footer";

type Copy = {
  back: string;
  title: string;
  subtitle: string;
  supportTitle: string;
  supportDescription: string;
  privacyTitle: string;
  privacyDescription: string;
  inAppTitle: string;
  inAppDescription: string;
  responseTitle: string;
  responseDescription: string;
  otherDocs: string;
  terms: string;
  privacy: string;
  refunds: string;
};

const COPY: Record<"es" | "en", Copy> = {
  es: {
    back: "Volver",
    title: "Contacto",
    subtitle:
      "Canales oficiales para soporte, privacidad y facturación. Todos los correos listados son monitoreados y respondidos.",
    supportTitle: "Soporte y consultas generales",
    supportDescription:
      "Problemas con la aplicación, preguntas sobre el producto, precios o facturación, y solicitudes de reembolso o cancelación.",
    privacyTitle: "Privacidad y datos personales",
    privacyDescription:
      "Ejercicio de derechos sobre tus datos (acceso, exportación, rectificación o eliminación) y cualquier consulta sobre la Política de Privacidad.",
    inAppTitle: "Dentro de la aplicación",
    inAppDescription:
      "Si ya tienes una cuenta, también puedes enviarnos comentarios o reportar un problema desde el botón de ayuda dentro de la aplicación.",
    responseTitle: "Tiempo de respuesta",
    responseDescription:
      "Respondemos todo correo en un plazo máximo de 2 días hábiles. Los reembolsos dentro del periodo de 14 días no requieren justificación (ver Política de Reembolsos).",
    otherDocs: "Documentos relacionados",
    terms: "Términos de Servicio",
    privacy: "Política de Privacidad",
    refunds: "Política de Reembolsos y Cancelación",
  },
  en: {
    back: "Back",
    title: "Contact",
    subtitle:
      "Official channels for support, privacy and billing. Every email listed here is monitored and answered.",
    supportTitle: "Support and general inquiries",
    supportDescription:
      "App problems, questions about the product, pricing or billing, and refund or cancellation requests.",
    privacyTitle: "Privacy and personal data",
    privacyDescription:
      "Exercising your rights over your data (access, export, rectification or deletion) and any question about the Privacy Policy.",
    inAppTitle: "Inside the app",
    inAppDescription:
      "If you already have an account, you can also send us feedback or report a problem from the help button inside the app.",
    responseTitle: "Response time",
    responseDescription:
      "We answer every email within a maximum of 2 business days. Refunds within the 14-day period require no justification (see the Refund Policy).",
    otherDocs: "Related documents",
    terms: "Terms of Service",
    privacy: "Privacy Policy",
    refunds: "Refund and Cancellation Policy",
  },
};

export function ContactContent() {
  const currentLocale = useLocale();
  const [selectedLang, setSelectedLang] = useState<"es" | "en">(
    currentLocale === "en" ? "en" : "es",
  );
  const copy = COPY[selectedLang] ?? COPY.es;

  return (
    <main className="mx-auto min-h-dvh max-w-4xl p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <Button variant="ghost" size="sm" asChild className="gap-2 text-muted-foreground">
          <Link href="/">
            <ArrowLeft className="size-4" />
            <span>{copy.back}</span>
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          <div className="inline-flex rounded-lg border bg-muted p-1 text-xs">
            <button
              type="button"
              onClick={() => setSelectedLang("es")}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                selectedLang === "es"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Español
            </button>
            <button
              type="button"
              onClick={() => setSelectedLang("en")}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                selectedLang === "en"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              English
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-2xl">
        <h1 className="text-4xl font-black leading-none tracking-[-0.04em] sm:text-5xl">
          {copy.title}
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">{copy.subtitle}</p>

        <div className="mt-8 grid gap-4">
          <Card className="rounded-[2rem]">
            <CardHeader className="p-6 pb-0">
              <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
                <Mail className="size-5" />
              </div>
              <CardTitle className="mt-3 text-lg">{copy.supportTitle}</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-2">
              <p className="text-sm leading-6 text-muted-foreground">{copy.supportDescription}</p>
              <a
                href="mailto:soporte@duobalanceapp.com"
                className="mt-3 inline-block font-bold text-primary hover:underline"
              >
                soporte@duobalanceapp.com
              </a>
            </CardContent>
          </Card>
          <Card className="rounded-[2rem]">
            <CardHeader className="p-6 pb-0">
              <div className="grid size-11 place-items-center rounded-2xl bg-secondary text-foreground">
                <Mail className="size-5" />
              </div>
              <CardTitle className="mt-3 text-lg">{copy.privacyTitle}</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-2">
              <p className="text-sm leading-6 text-muted-foreground">{copy.privacyDescription}</p>
              <a
                href="mailto:privacy@duobalanceapp.com"
                className="mt-3 inline-block font-bold text-primary hover:underline"
              >
                privacy@duobalanceapp.com
              </a>
            </CardContent>
          </Card>
          <Card className="rounded-[2rem]">
            <CardHeader className="p-6 pb-0">
              <div className="grid size-11 place-items-center rounded-2xl bg-secondary text-foreground">
                <MessageSquareText className="size-5" />
              </div>
              <CardTitle className="mt-3 text-lg">{copy.inAppTitle}</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-2">
              <p className="text-sm leading-6 text-muted-foreground">{copy.inAppDescription}</p>
            </CardContent>
          </Card>
          <div className="rounded-[2rem] border bg-background p-6">
            <h2 className="text-sm font-black">{copy.responseTitle}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {copy.responseDescription}
            </p>
          </div>
        </div>

        <div className="mt-8 border-t pt-6">
          <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {copy.otherDocs}
          </h2>
          <div className="mt-3 flex flex-wrap gap-4 text-sm font-bold text-primary">
            <Link href="/terms" className="hover:underline">
              {copy.terms}
            </Link>
            <Link href="/privacy" className="hover:underline">
              {copy.privacy}
            </Link>
            <Link href="/refunds" className="hover:underline">
              {copy.refunds}
            </Link>
          </div>
        </div>
      </div>

      <PublicFooter />
    </main>
  );
}
