"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import es from "@/messages/es.json";
import en from "@/messages/en.json";
import ptBR from "@/messages/pt-BR.json";

// next-intl runs client-only here — no routing/middleware, since middleware.ts
// doesn't exist in a static export (architecture rule #1). Locale resolution
// order (household -> browser -> es) is #16's full scope; this is the minimal
// slice #14 needs so auth copy resolves through next-intl.
export function mergeMessages(base: Record<string, unknown>, overrides: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const baseValue = base[key];
    merged[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      baseValue &&
      typeof baseValue === "object" &&
      !Array.isArray(baseValue)
        ? mergeMessages(baseValue as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return merged;
}

const MESSAGES = { es, en, "pt-BR": mergeMessages(en, ptBR) } as const;
export type SupportedLocale = keyof typeof MESSAGES;

export function toSupportedLocale(locale: string | null | undefined): SupportedLocale {
  const language = locale?.toLowerCase().split("-")[0];
  if (language === "pt") return "pt-BR";
  return language === "en" ? "en" : "es";
}

function detectBrowserLocale(): SupportedLocale {
  if (typeof navigator === "undefined") return "es";
  return toSupportedLocale(navigator.language);
}

type LocaleContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(detectBrowserLocale);

  // Avoids next-intl's ENVIRONMENT_FALLBACK timezone warning. Business dates
  // are computed with the household timezone via lib/dates.ts, never here.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Keep <html lang> in sync so screen readers announce in the right language.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function setLocale(next: SupportedLocale) {
    setLocaleState(next);
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone={timeZone}>
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}

export function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocaleContext must be used within a LocaleProvider");
  }
  return ctx;
}
