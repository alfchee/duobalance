"use client";

import { useLocale, useTranslations } from "next-intl";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { displayBalance, type AccountWithBalance } from "@/lib/accounts";
import { sumBalances, type BalanceSectionId, type RatesByCode } from "@/lib/balances";
import { useHousehold } from "@/hooks/useHousehold";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { BalancesRow } from "./balances-row";

const SECTION_IDS: BalanceSectionId[] = ["cash", "credit", "savings", "loans"];

// One section of the Balances view: subtotal in the base currency plus the
// rows that fall into it. The subtotal uses the same displayBalance rule as
// the row labels (credit/loan show negative), so a positive number always
// means the household is ahead, never that the rendering is wrong.
export function BalancesSection({
  section,
  accounts,
  now,
  ratesByCode,
  onReorder,
}: {
  section: BalanceSectionId;
  accounts: AccountWithBalance[];
  now: Date;
  ratesByCode: RatesByCode;
  onReorder: (accounts: AccountWithBalance[]) => void;
}) {
  const t = useTranslations("balances");
  const locale = useLocale();
  const { baseCurrency } = useHousehold();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const subtotal = baseCurrency
    ? sumBalances(accounts, baseCurrency, ratesByCode, displayBalance)
    : null;

  if (accounts.length === 0) return null;

  return (
    <section aria-label={t(`section.${section}`)} className="space-y-2">
      <header className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(`section.${section}`)}
        </h2>
        <p
          className={cn(
            "text-sm font-medium tabular-nums",
            subtotal != null && subtotal < 0 && "text-destructive",
          )}
        >
          {baseCurrency && subtotal != null ? formatMoney(subtotal, baseCurrency, locale) : "—"}
        </p>
      </header>
      <DndContext
        collisionDetection={closestCenter}
        sensors={sensors}
        onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return;
          const oldIndex = accounts.findIndex((account) => account.id === active.id);
          const newIndex = accounts.findIndex((account) => account.id === over.id);
          if (oldIndex < 0 || newIndex < 0) return;
          onReorder(arrayMove(accounts, oldIndex, newIndex));
        }}
      >
        <SortableContext
          items={accounts.map((account) => account.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="overflow-hidden rounded-lg border bg-card">
            {accounts.map((account) => (
              <BalancesRow key={account.id} account={account} now={now} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}

export const BALANCES_SECTION_IDS = SECTION_IDS;
