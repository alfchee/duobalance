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
import { useHousehold } from "@/hooks/useHousehold";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { isNumberFormatPref, type NumberFormatPref } from "@/lib/money";

const NUMBER_FORMATS: readonly NumberFormatPref[] = ["locale", "dot_decimal", "comma_decimal"];

export function NumberFormatSwitcher() {
  const t = useTranslations("settings.numberFormat");
  const { householdId, numberFormat } = useHousehold();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (value: NumberFormatPref) => {
      const supabase = createSupabaseBrowser();
      if (!supabase) throw new Error("Supabase is unavailable");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("No authenticated user");
      const { error } = await supabase
        .from("user_preferences")
        .upsert({ user_id: user.id, number_format: value }, { onConflict: "user_id" });
      if (error) throw error;
      return value;
    },
    onSuccess: () => {
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
        value={numberFormat}
        disabled={!householdId || mutation.isPending}
        onValueChange={(value) => {
          if (isNumberFormatPref(value)) mutation.mutate(value);
        }}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {NUMBER_FORMATS.map((format) => (
            <SelectItem key={format} value={format}>
              {t(`options.${format}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
