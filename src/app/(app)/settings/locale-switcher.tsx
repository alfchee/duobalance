"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocaleContext, type SupportedLocale } from "@/components/locale-provider";
import { createSupabaseBrowser } from "@/lib/supabase/client";

const LOCALES: SupportedLocale[] = ["es", "en", "pt-BR"];

// Radix's onValueChange hands us an arbitrary string; narrow it before it
// reaches setLocale so a malformed value can't silently become a valid locale.
function isSupportedLocale(value: string): value is SupportedLocale {
  return (LOCALES as readonly string[]).includes(value);
}

export function LocaleSwitcher() {
  const t = useTranslations("settings.locale");
  const tLanguages = useTranslations("settings.languages");
  const { locale, setLocale } = useLocaleContext();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (value: SupportedLocale) => {
      const supabase = createSupabaseBrowser();
      if (!supabase) throw new Error("Supabase is unavailable");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("No authenticated user");
      const { error } = await supabase
        .from("user_preferences")
        .upsert({ user_id: user.id, locale: value }, { onConflict: "user_id" });
      if (error) throw error;
      return value;
    },
    onSuccess: (value) => {
      setLocale(value);
      queryClient.invalidateQueries({ queryKey: ["user-preferences"] });
    },
  });

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <Select
        value={locale}
        disabled={mutation.isPending}
        onValueChange={(value) => {
          if (isSupportedLocale(value)) mutation.mutate(value);
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
