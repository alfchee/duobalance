"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useCurrencies } from "@/hooks/useCurrencies";

export function CurrencyPicker({
  value,
  onSelect,
  className,
}: {
  value: string | null;
  onSelect: (code: string) => void;
  className?: string;
}) {
  const t = useTranslations("accounts.form");
  const { data: currencies } = useCurrencies();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = (currencies ?? []).filter(
    (c) =>
      c.code.toLowerCase().includes(query.toLowerCase()) ||
      c.name_en.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = (currencies ?? []).find((c) => c.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("w-full justify-start font-normal", className)}
          aria-label={t("currency")}
        >
          {selected ? `${selected.code} — ${selected.name_en}` : t("currencyPlaceholder")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("currencySearch")}
              className="pl-8"
            />
          </div>
        </div>
        <ul className="max-h-64 overflow-y-auto">
          {filtered.map((c) => (
            <li key={c.code}>
              <button
                type="button"
                onClick={() => {
                  onSelect(c.code);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-sm text-left hover:bg-accent"
              >
                <span>
                  {c.code} — {c.name_en}
                </span>
                {c.code === value ? <Check className="size-4 text-primary" /> : null}
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t("currencyNoResults")}</li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
