"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import es from "@/messages/es.json";
import en from "@/messages/en.json";

// next-intl runs client-only here — no routing/middleware, since middleware.ts
// doesn't exist in a static export (architecture rule #1). Locale resolution
// order (household -> browser -> es) is #16's full scope; this is the minimal
// slice #14 needs so auth copy resolves through next-intl.
const MESSAGES = { es, en } as const;
export type SupportedLocale = keyof typeof MESSAGES;

const STORAGE_KEY = "duobalance:locale";

export function toSupportedLocale(locale: string | null | undefined): SupportedLocale {
  return locale === "en" ? "en" : "es";
}

function detectBrowserLocale(): SupportedLocale {
  if (typeof navigator === "undefined") return "es";
  return toSupportedLocale(navigator.language.slice(0, 2).toLowerCase());
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

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "es" || stored === "en") {
      setLocaleState(stored);
      setHasStoredPreference(true);
    } else {
      setLocaleState(detectBrowserLocale());
    }
  }, []);

  function setLocale(next: SupportedLocale) {
    setLocaleState(next);
    setHasStoredPreference(true);
    localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <LocaleContext.Provider value={{ locale, hasStoredPreference, setLocale }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
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
