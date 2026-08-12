"use client";

import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocaleContext, type SupportedLocale } from "@/components/locale-provider";

const LOCALES: SupportedLocale[] = ["es", "en"];

// Radix's onValueChange hands us an arbitrary string; narrow it before it
// reaches setLocale so a malformed value can't silently become a valid locale.
function isSupportedLocale(value: string): value is SupportedLocale {
  return (LOCALES as readonly string[]).includes(value);
}

export function LocaleSwitcher() {
  const t = useTranslations("settings.locale");
  const tLanguages = useTranslations("settings.languages");
  const { locale, setLocale } = useLocaleContext();

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <Select
        value={locale}
        onValueChange={(value) => {
          if (isSupportedLocale(value)) setLocale(value);
        }}
      >
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LOCALES.map((code) => (
            <SelectItem key={code} value={code}>
              {tLanguages(code)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
