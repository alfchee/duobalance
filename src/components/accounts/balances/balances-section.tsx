"use client";

import { useLocale, useTranslations } from "next-intl";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { AccountWithBalance } from "@/lib/accounts";
import type { BalanceSectionId } from "@/lib/balances";
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
  baseCurrency,
  now,
  subtotal,
  onReorder,
}: {
  section: BalanceSectionId;
  accounts: AccountWithBalance[];
  baseCurrency: string | null;
  now: Date;
  subtotal: number | null;
  onReorder: (accounts: AccountWithBalance[]) => void;
}) {
  const t = useTranslations("balances");
  const locale = useLocale();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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
