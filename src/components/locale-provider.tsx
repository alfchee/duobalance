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
function mergeMessages(base: Record<string, unknown>, overrides: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const baseValue = base[key];
    merged[key] =
      value && typeof value === "object" && baseValue && typeof baseValue === "object"
        ? mergeMessages(baseValue as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return merged;
}

const MESSAGES = { es, en, "pt-BR": mergeMessages(en, ptBR) } as const;
export type SupportedLocale = keyof typeof MESSAGES;

const STORAGE_KEY = "duobalance:locale";

export function toSupportedLocale(locale: string | null | undefined): SupportedLocale {
  if (locale === "pt" || locale === "pt-BR") return "pt-BR";
  return locale === "en" ? "en" : "es";
}

function detectBrowserLocale(): SupportedLocale {
  if (typeof navigator === "undefined") return "es";
  return toSupportedLocale(navigator.language);
}

type LocaleContextValue = {
  locale: SupportedLocale;
  hasStoredPreference: boolean;
  setLocale: (locale: SupportedLocale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>("es");
  const [hasStoredPreference, setHasStoredPreference] = useState(false);

  // Avoids next-intl's ENVIRONMENT_FALLBACK timezone warning. Business dates
  // are computed with the household timezone via lib/dates.ts, never here.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "es" || stored === "en" || stored === "pt-BR") {
      setLocaleState(stored);
      setHasStoredPreference(true);
    } else {
      setLocaleState(detectBrowserLocale());
    }
  }, []);

  // Keep <html lang> in sync so screen readers announce in the right language.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function setLocale(next: SupportedLocale) {
    setLocaleState(next);
    setHasStoredPreference(true);
    localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <LocaleContext.Provider value={{ locale, hasStoredPreference, setLocale }}>
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
