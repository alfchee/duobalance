"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories, useCategoryMutations, useCategorizationRules } from "@/hooks/useCategories";
import { useHousehold } from "@/hooks/useHousehold";
import { categoryTree, type Category, type CategoryKind } from "@/lib/categories";
import { cn } from "@/lib/utils";

const ICONS = ["🏠", "🛒", "🚗", "🍽️", "❤️", "🎓", "🎬", "💼", "💰", "📦"];

type Draft = {
  name: string;
  icon: string;
  colorHex: string;
  kind: CategoryKind;
  parentId: string | null;
};

function toDraft(category: Category | null): Draft {
  return {
    name: category?.name ?? "",
    icon: category?.icon ?? "",
    colorHex: category?.color_hex ?? "#64748B",
    kind: category?.kind === "income" ? "income" : "expense",
    parentId: category?.parent_id ?? null,
  };
}

export function CategoriesSection({ standalone = false }: { standalone?: boolean }) {
  const t = useTranslations("categories");
  const { householdId } = useHousehold();
  const { data: categories, isLoading, isError, refetch } = useCategories(householdId);
  const { data: rules } = useCategorizationRules(householdId);
  const { create, update, remove } = useCategoryMutations(householdId);
  const [editing, setEditing] = useState<Category | null | undefined>(undefined);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const ruleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const rule of rules ?? [])
      counts.set(rule.category_id, (counts.get(rule.category_id) ?? 0) + 1);
    return counts;
  }, [rules]);

  async function handleDelete(category: Category) {
    setDeleteError(null);
    try {
      await remove.mutateAsync(category.id);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t("deleteError"));
    }
  }

  const content = isLoading ? (
    <Skeleton className="h-48 w-full" />
  ) : isError ? (
    <div className="space-y-2">
      <p role="alert" className="text-sm text-destructive">
        {t("loadError")}
      </p>
      <Button variant="outline" size="sm" onClick={() => void refetch()}>
        {t("retry")}
      </Button>
    </div>
  ) : (
    <div className="space-y-6">
      {deleteError ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {deleteError}
        </p>
      ) : null}
      {(["expense", "income"] as const).map((kind) => (
        <CategoryList
          key={kind}
          categories={categoryTree(categories ?? [], kind)}
          kind={kind}
          ruleCounts={ruleCounts}
          onEdit={setEditing}
          onDelete={handleDelete}
          deletePending={remove.isPending}
        />
      ))}
    </div>
  );

  return (
    <>
      {standalone ? (
        <main className="mx-auto w-full max-w-2xl p-6">
          <SectionHeader onCreate={() => setEditing(null)} />
          <div className="mt-4">{content}</div>
        </main>
      ) : (
        <Card className="mt-4">
          <CardHeader>
            <SectionHeader onCreate={() => setEditing(null)} />
          </CardHeader>
          <CardContent>{content}</CardContent>
        </Card>
      )}
      <CategoryForm
        key={editing?.id ?? "create"}
        category={editing ?? null}
        categories={categories ?? []}
        open={editing !== undefined}
        pending={create.isPending || update.isPending}
        onClose={() => setEditing(undefined)}
        onSave={async (draft) => {
          if (editing)
            await update.mutateAsync({
              id: editing.id,
              name: draft.name,
              icon: draft.icon || null,
              color_hex: draft.colorHex,
              kind: draft.kind,
              parent_id: draft.parentId,
            });
          else
            await create.mutateAsync({
              name: draft.name,
              icon: draft.icon || null,
              color_hex: draft.colorHex,
              kind: draft.kind,
              parent_id: draft.parentId,
              display_order: categories?.length ?? 0,
            });
          setEditing(undefined);
        }}
      />
    </>
  );
}

function SectionHeader({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations("categories");
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription className="mt-1">{t("subtitle")}</CardDescription>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus />
        {t("new")}
      </Button>
    </div>
  );
}

function CategoryList({
  categories,
  kind,
  ruleCounts,
  onEdit,
  onDelete,
  deletePending,
}: {
  categories: Category[];
  kind: CategoryKind;
  ruleCounts: Map<string, number>;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  deletePending: boolean;
}) {
  const t = useTranslations("categories");
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{t(`kind.${kind}`)}</h2>
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {categories.map((category) => (
            <li
              key={category.id}
              className={cn("flex items-center gap-3 px-3 py-2", category.parent_id && "pl-8")}
            >
              <span
                aria-hidden
                className="size-3 rounded-full"
                style={{ backgroundColor: category.color_hex ?? "#64748B" }}
              />
              <span>{category.icon}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{category.name}</span>
              <Link className="text-xs text-muted-foreground underline" href="/settings/rules">
                {t("ruleCount", { count: ruleCounts.get(category.id) ?? 0 })}
              </Link>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("edit")}
                onClick={() => onEdit(category)}
              >
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("delete")}
                onClick={() => onDelete(category)}
                disabled={deletePending}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CategoryForm({
  category,
  categories,
  open,
  pending,
  onClose,
  onSave,
}: {
  category: Category | null;
  categories: Category[];
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (draft: Draft) => Promise<void>;
}) {
  const t = useTranslations("categories");
  const [draft, setDraft] = useState(() => toDraft(category));
  const [error, setError] = useState<string | null>(null);
  const eligibleParents = categories.filter(
    (candidate) =>
      candidate.kind === draft.kind &&
      candidate.parent_id === null &&
      candidate.id !== category?.id,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) return setError(t("nameRequired"));
    setError(null);
    try {
      await onSave({ ...draft, name: draft.name.trim() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("saveError"));
    }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? t("editTitle") : t("newTitle")}</DialogTitle>
          <DialogDescription>{t("formDescription")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="category-name">{t("name")}</Label>
            <Input
              id="category-name"
              maxLength={80}
              value={draft.name}
              onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("kindLabel")}</Label>
            <Select
              value={draft.kind}
              onValueChange={(kind) =>
                setDraft((value) => ({ ...value, kind: kind as CategoryKind, parentId: null }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">{t("kind.expense")}</SelectItem>
                <SelectItem value="income">{t("kind.income")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("parent")}</Label>
            <Select
              value={draft.parentId ?? "root"}
              onValueChange={(parentId) =>
                setDraft((value) => ({ ...value, parentId: parentId === "root" ? null : parentId }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root">{t("root")}</SelectItem>
                {eligibleParents.map((parent) => (
                  <SelectItem key={parent.id} value={parent.id}>
                    {parent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("icon")}</Label>
            <div className="flex flex-wrap gap-2">
              {ICONS.map((icon) => (
                <Button
                  key={icon}
                  type="button"
                  variant={draft.icon === icon ? "default" : "outline"}
                  size="icon"
                  onClick={() => setDraft((value) => ({ ...value, icon }))}
                >
                  {icon}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-color">{t("color")}</Label>
            <Input
              id="category-color"
              type="color"
              value={draft.colorHex}
              onChange={(event) =>
                setDraft((value) => ({ ...value, colorHex: event.target.value }))
              }
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
