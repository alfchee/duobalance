"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdMembers } from "@/hooks/useHouseholdMembers";
import type { AccountWithBalance } from "@/lib/accounts";
import { type CurrencyLine } from "@/lib/balances";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

const SOURCE_LABELS = {
  override: "source.override",
  feed: "source.feed",
} as const;

// Top of the Balances screen: member avatars, account count, household net
// worth in the base currency. Tapping the net worth opens the per-currency
// breakdown popover (#21 AC: "transparently show the conversion used").
export function BalancesHeader({
  accounts,
  baseRateDate,
  breakdown,
  netWorth,
}: {
  accounts: AccountWithBalance[];
  baseRateDate: string | null;
  breakdown: CurrencyLine[];
  netWorth: number | null;
}) {
  const t = useTranslations("balances");
  const tSettings = useTranslations("settings.overrides");
  const locale = useLocale();
  const { householdId, baseCurrency, memberId } = useHousehold();
  const { data: members } = useHouseholdMembers(householdId);
  const [open, setOpen] = useState(false);

  const activeMembers = (members ?? []).filter((m) => m.role === "owner" || m.role === "partner");
  const partner = activeMembers.find((m) => m.id !== memberId);
  const me = activeMembers.find((m) => m.id === memberId);
  const count = accounts.length;

  return (
    <section aria-label={t("headerAriaLabel")} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center -space-x-2">
          <MemberAvatar
            label={me?.display_name ?? "—"}
            color={me?.color_hex ?? null}
            isPartner={false}
          />
          <MemberAvatar
            label={partner?.display_name ?? t("partnerPlaceholder")}
            color={partner?.color_hex ?? null}
            isPartner
          />
        </div>
        <span className="text-xs text-muted-foreground">{t("accountCount", { count })}</span>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="group flex w-full flex-col items-start gap-1 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/40"
            aria-expanded={open}
            disabled={!baseCurrency}
          >
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("netWorthLabel")}
            </span>
            <span
              className={cn(
                "text-3xl font-semibold tabular-nums",
                netWorth != null && netWorth < 0 && "text-destructive",
              )}
            >
              {baseCurrency && netWorth != null
                ? formatMoney(netWorth, baseCurrency, locale)
                : t("netWorthLoading")}
            </span>
            {breakdown.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ChevronDown className="size-3" />
                {t("breakdownToggle")}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <CurrencyBreakdown
            base={baseCurrency ?? "USD"}
            baseRateDate={baseRateDate}
            breakdown={breakdown}
            netWorth={netWorth}
            sourceLabelOverride={tSettings}
            locale={locale}
            onClose={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </section>
  );
}

function MemberAvatar({
  label,
  color,
  isPartner,
}: {
  label: string;
  color: string | null;
  isPartner: boolean;
}) {
  const t = useTranslations("balances");
  const initials = label
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className={cn(
        "flex size-9 items-center justify-center rounded-full border-2 border-background text-xs font-semibold",
        isPartner ? "ring-1 ring-muted-foreground/20" : null,
      )}
      style={
        color ? { backgroundColor: color, color: "#fff" } : { backgroundColor: "var(--muted)" }
      }
      aria-label={isPartner ? t("partnerAriaLabel", { name: label }) : label}
      title={label}
    >
      {initials || "?"}
    </div>
  );
}

function CurrencyBreakdown({
  base,
  baseRateDate,
  breakdown,
  netWorth,
  sourceLabelOverride,
  locale,
  onClose,
}: {
  base: string;
  baseRateDate: string | null;
  breakdown: CurrencyLine[];
  netWorth: number | null;
  sourceLabelOverride: (key: string) => string;
  locale: string;
  onClose: () => void;
}) {
  const t = useTranslations("balances");
  return (
    <div className="space-y-3 p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("breakdownTitle")}
        </p>
        <p className="text-lg font-semibold tabular-nums">
          {netWorth != null ? formatMoney(netWorth, base, locale) : "—"}
        </p>
        {baseRateDate ? (
          <p className="text-xs text-muted-foreground">
            {t("breakdownBaseRate", {
              date: formatRateDate(baseRateDate, locale),
            })}
          </p>
        ) : null}
      </div>

      {breakdown.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {breakdown.map((line) => (
            <li
              key={line.code}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium">{line.code}</p>
                <p className="text-xs text-muted-foreground">
                  {t("rateUsed", {
                    rate: new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(
                      line.usdRate,
                    ),
                    date: formatRateDate(line.rateDate, locale),
                  })}
                  {" · "}
                  {sourceLabelOverride(SOURCE_LABELS[line.source])}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium tabular-nums">
                  {formatMoney(line.amount, line.code, locale)}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  ≈ {formatMoney(line.baseAmount, base, locale)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("breakdownEmpty")}</p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t("breakdownClose")}
        </button>
      </div>
    </div>
  );
}

function formatRateDate(rateDate: string, locale: string): string {
  return formatDate(new Date(`${rateDate}T00:00:00Z`), locale, "UTC");
}
