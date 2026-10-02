import type { Metadata } from "next";
import { ContactContent } from "@/components/site/contact-content";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Contacto — DuoBalance",
  description:
    "Canales oficiales de contacto de DuoBalance: soporte, facturación y privacidad. Todos los correos son monitoreados y respondidos en un máximo de 2 días hábiles.",
  alternates: { canonical: "https://duobalanceapp.com/contact" },
};

export default function ContactPage() {
  return <ContactContent />;
}
