"use client";

import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useHousehold } from "@/hooks/useHousehold";
import { useAccountMutations, useAccounts } from "@/hooks/useAccounts";
import { reorderAccounts } from "@/lib/accounts";
import { useAccountsUiStore } from "@/store/accounts";
import { AccountRow } from "./account-row";

export function AccountList() {
  const t = useTranslations("accounts.list");
  const { householdId, memberId } = useHousehold();
  const { data: accounts, isLoading, isError, refetch } = useAccounts(householdId);
  const { reorder } = useAccountMutations(householdId);
  const { showArchived, setShowArchived } = useAccountsUiStore();

  const all = accounts ?? [];
  const visible = all.filter((a) => !a.is_archived);
  const archived = all.filter((a) => a.is_archived);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !memberId) return;
    // Archived rows are disabled in the sortable, so both active and over are
    // always active accounts — index against `visible` only.
    const ids = visible.map((a) => a.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextVisible = arrayMove(visible, oldIndex, newIndex);
    reorder.mutate({
      accounts: reorderAccounts(all, nextVisible),
      memberId,
    });
  }

  if (isLoading) {
    return (
      <ul className="space-y-2">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
        ))}
      </ul>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">{t("loadingError")}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  const sortableIds = (showArchived ? all : visible).map((a) => a.id);

  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {visible.length > 0 ? (
            <ul className="space-y-2">
              {visible.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </ul>
          ) : null}

          {showArchived && archived.length > 0 ? (
            <div className="space-y-2">
              <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("archivedSection")}
              </h2>
              <ul className="space-y-2">
                {archived.map((account) => (
                  <AccountRow key={account.id} account={account} />
                ))}
              </ul>
            </div>
          ) : null}
        </SortableContext>
      </DndContext>

      {archived.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setShowArchived(!showArchived)}
        >
          {showArchived ? t("hideArchived") : t("showArchived", { count: archived.length })}
        </Button>
      ) : null}
    </div>
  );
}
