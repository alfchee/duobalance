"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Globe } from "lucide-react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicFooter } from "@/components/site/public-footer";

type Copy = {
  back: string;
  badge: string;
  title: string;
  subtitle: string;
  notLiveBadge: string;
  notLiveTitle: string;
  notLiveDescription: string;
  todayTitle: string;
  todayItems: readonly string[];
  futureTitle: string;
  futureItems: readonly string[];
  refundsCta: string;
  contactCta: string;
  contactDescription: string;
};

const COPY: Record<"es" | "en", Copy> = {
  es: {
    back: "Volver",
    badge: "Fase Beta",
    title: "Precios",
    subtitle:
      "Lo que se cobra hoy, lo que se cobrará cuando la facturación pagada se habilite, y cuándo.",
    notLiveBadge: "Facturación pagada no disponible",
    notLiveTitle: "La facturación pagada todavía no está disponible",
    notLiveDescription:
      "DuoBalance no procesa pagos en este momento: no hay suscripciones activas, ni cobros recurrentes, ni pagos únicos. Cuando la facturación se habilite, esta página mostrará el precio, la moneda y el intervalo de facturación antes de que exista cualquier cobro.",
    todayTitle: "Lo que se cobra hoy",
    todayItems: [
      "DuoBalance es gratuito durante toda la fase Beta.",
      "Todas las funciones del producto están disponibles sin costo.",
      "No hay tarjeta de crédito ni datos de pago involucrados en ninguna parte del registro.",
    ],
    futureTitle: "Cuando la facturación se habilite",
    futureItems: [
      "Plan de suscripción mensual para todo el hogar (una sola suscripción por hogar).",
      "Precios expresados en dólares estadounidenses (USD).",
      "Se informará el precio con antelación y se requerirá aceptación explícita antes del primer cobro.",
      "Cancelación en cualquier momento desde Configuración, con garantía de reembolso completo dentro de los 14 días posteriores a un cobro.",
    ],
    refundsCta: "Política de reembolsos y cancelación",
    contactCta: "Contacto",
    contactDescription:
      "¿Dudas sobre precios o facturación? Escríbenos y respondemos en un máximo de 2 días hábiles.",
  },
  en: {
    back: "Back",
    badge: "Beta phase",
    title: "Pricing",
    subtitle: "What is charged today, what will be charged once paid billing is enabled, and when.",
    notLiveBadge: "Paid billing not available",
    notLiveTitle: "Paid billing is not yet available",
    notLiveDescription:
      "DuoBalance does not process payments at this time: there are no active subscriptions, no recurring charges, and no one-time payments. When billing is enabled, this page will show the price, the currency and the billing interval before any charge exists.",
    todayTitle: "What is charged today",
    todayItems: [
      "DuoBalance is free during the entire Beta phase.",
      "All product features are available at no cost.",
      "No credit card or payment data is requested anywhere in the signup flow.",
    ],
    futureTitle: "When billing is enabled",
    futureItems: [
      "Monthly subscription plan for the whole household (one subscription per household).",
      "Prices expressed in US dollars (USD).",
      "The price will be announced in advance and explicit acceptance will be required before the first charge.",
      "Cancel at any time from Settings, with a full refund guarantee within 14 days of any charge.",
    ],
    refundsCta: "Refund and cancellation policy",
    contactCta: "Contact",
    contactDescription:
      "Questions about pricing or billing? Write to us and we will reply within 2 business days.",
  },
};

export function PricingContent() {
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
        <p className="inline-flex rounded-full bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {copy.badge}
        </p>
        <h1 className="mt-4 text-4xl font-black leading-none tracking-[-0.04em] sm:text-5xl">
          {copy.title}
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">{copy.subtitle}</p>

        <div className="mt-8 rounded-[2rem] border-2 border-warning/40 bg-warning/5 p-6">
          <p className="inline-flex rounded-full bg-warning/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-warning">
            {copy.notLiveBadge}
          </p>
          <h2 className="mt-4 text-xl font-black tracking-tight">{copy.notLiveTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.notLiveDescription}</p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card className="rounded-[2rem]">
            <CardHeader className="p-6 pb-0">
              <CardTitle className="text-lg">{copy.todayTitle}</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-3">
              <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
                {copy.todayItems.map((item) => (
                  <li key={item} className="flex gap-2">
                    <Check className="mt-1 size-4 shrink-0 text-success" />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="rounded-[2rem]">
            <CardHeader className="p-6 pb-0">
              <CardTitle className="text-lg">{copy.futureTitle}</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-3">
              <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
                {copy.futureItems.map((item) => (
                  <li key={item} className="flex gap-2">
                    <Check className="mt-1 size-4 shrink-0 text-success" />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 flex flex-col gap-3 rounded-[2rem] border bg-background p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-black">{copy.contactCta}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {copy.contactDescription}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 text-sm">
            <Button asChild variant="outline">
              <Link href="/refunds">{copy.refundsCta}</Link>
            </Button>
            <Button asChild>
              <Link href="/contact">{copy.contactCta}</Link>
            </Button>
          </div>
        </div>
      </div>

      <PublicFooter />
    </main>
  );
}
