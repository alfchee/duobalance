import type { Metadata } from "next";
import { PricingContent } from "@/components/site/pricing-content";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Precios — DuoBalance",
  description:
    "DuoBalance es gratuito durante la fase Beta. La facturación pagada (suscripción mensual en USD) todavía no está disponible; este es el plan de precios de referencia.",
  alternates: { canonical: "https://duobalanceapp.com/pricing" },
};

export default function PricingPage() {
  return <PricingContent />;
}
