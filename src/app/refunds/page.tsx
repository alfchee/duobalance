import type { Metadata } from "next";
import { RefundsContent } from "@/components/site/refunds-content";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Política de Reembolsos y Cancelación — DuoBalance",
  description:
    "DuoBalance es gratuito durante la fase Beta y no procesa pagos todavía. Cómo cancelar, garantía de reembolso completo dentro de los 14 días de un cobro y devolución de cargos duplicados.",
  alternates: { canonical: "https://duobalanceapp.com/refunds" },
};

export default function RefundsPage() {
  return <RefundsContent />;
}
