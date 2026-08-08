"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  useApplyCategorizationRules,
  useCategories,
  useCategorizationRuleMutations,
  useCategorizationRules,
  useRuleApplicationPreview,
} from "@/hooks/useCategories";
import { useHousehold } from "@/hooks/useHousehold";
import { matchingRule, type CategorizationRule } from "@/lib/categories";

type Draft = { matchPattern: string; categoryId: string; priority: number };

function toDraft(rule: CategorizationRule | null): Draft {
  return {
    matchPattern: rule?.match_pattern ?? "%",
    categoryId: rule?.category_id ?? "",
    priority: rule?.priority ?? 100,
  };
}

export function RulesSection({ standalone = false }: { standalone?: boolean }) {
  const t = useTranslations("rules");
  const { householdId } = useHousehold();
  const { data: categories } = useCategories(householdId);
  const { data: rules, isLoading, isError, refetch } = useCategorizationRules(householdId);
  const { create, update, remove } = useCategorizationRuleMutations(householdId);
  const applyRules = useApplyCategorizationRules(householdId);
  const [editing, setEditing] = useState<CategorizationRule | null | undefined>(undefined);
  const [sample, setSample] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { data: preview, isLoading: isPreviewLoading } = useRuleApplicationPreview(
    householdId,
    rules ?? [],
    previewOpen,
  );
  const winner = useMemo(() => matchingRule(sample, rules ?? []), [sample, rules]);
  const categoryById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category])),
    [categories],
  );

  async function reorder(rule: CategorizationRule, direction: -1 | 1) {
    const ordered = rules ?? [];
    const current = ordered.findIndex((candidate) => candidate.id === rule.id);
    const other = ordered[current + direction];
    if (!other) return;
    try {
      await Promise.all([
        update.mutateAsync({ id: rule.id, priority: other.priority }),
        update.mutateAsync({ id: other.id, priority: rule.priority }),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("saveError"));
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
    <div className="space-y-5">
      <div className="rounded-md border p-3">
        <Label htmlFor="rule-tester">{t("tester.label")}</Label>
        <Input
          id="rule-tester"
          className="mt-2"
          value={sample}
          onChange={(event) => setSample(event.target.value)}
          placeholder={t("tester.placeholder")}
        />
        {sample ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {winner
              ? t("tester.winner", {
                  pattern: winner.match_pattern,
                  category: categoryById.get(winner.category_id)?.name ?? t("unknownCategory"),
                })
              : t("tester.noMatch")}
          </p>
        ) : null}
      </div>
      {(rules ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {(rules ?? []).map((rule, index) => (
            <li key={rule.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm">{rule.match_pattern}</p>
                <p className="text-xs text-muted-foreground">
                  {categoryById.get(rule.category_id)?.name ?? t("unknownCategory")} ·{" "}
                  {t("priority", { value: rule.priority })}
                </p>
              </div>
              <Switch
                checked={rule.is_active}
                aria-label={t("active")}
                onCheckedChange={(isActive) => update.mutate({ id: rule.id, is_active: isActive })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("moveUp")}
                disabled={index === 0}
                onClick={() => void reorder(rule, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("moveDown")}
                disabled={index === (rules?.length ?? 0) - 1}
                onClick={() => void reorder(rule, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("edit")}
                onClick={() => setEditing(rule)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("delete")}
                onClick={() => remove.mutate(rule.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        variant="outline"
        onClick={() => setPreviewOpen(true)}
        disabled={(rules?.length ?? 0) === 0}
      >
        {t("bulkApply")}
      </Button>
    </div>
  );

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription className="mt-1">{t("subtitle")}</CardDescription>
      </div>
      <Button size="sm" onClick={() => setEditing(null)}>
        <Plus />
        {t("new")}
      </Button>
    </div>
  );
  return (
    <>
      {standalone ? (
        <main className="mx-auto w-full max-w-2xl p-6">
          <div>{header}</div>
          <div className="mt-4">{content}</div>
        </main>
      ) : (
        <Card className="mt-4">
          <CardHeader>{header}</CardHeader>
          <CardContent>{content}</CardContent>
        </Card>
      )}
      <RuleForm
        key={editing?.id ?? "create"}
        rule={editing ?? null}
        categories={categories ?? []}
        open={editing !== undefined}
        pending={create.isPending || update.isPending}
        onClose={() => setEditing(undefined)}
        onSave={async (draft) => {
          if (editing)
            await update.mutateAsync({
              id: editing.id,
              match_pattern: draft.matchPattern,
              category_id: draft.categoryId,
              priority: draft.priority,
            });
          else
            await create.mutateAsync({
              match_pattern: draft.matchPattern,
              category_id: draft.categoryId,
              priority: draft.priority,
              is_active: true,
              account_id: null,
            });
          setEditing(undefined);
        }}
      />
      <BulkApplyDialog
        open={previewOpen}
        preview={preview ?? []}
        loading={isPreviewLoading}
        pending={applyRules.isPending}
        categoryById={categoryById}
        onClose={() => setPreviewOpen(false)}
        onConfirm={async () => {
          try {
            await applyRules.mutateAsync(preview ?? []);
            setPreviewOpen(false);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : t("saveError"));
          }
        }}
      />
    </>
  );
}

function BulkApplyDialog({
  open,
  preview,
  loading,
  pending,
  categoryById,
  onClose,
  onConfirm,
}: {
  open: boolean;
  preview: { categoryId: string; transactionIds: string[] }[];
  loading: boolean;
  pending: boolean;
  categoryById: Map<string, { name: string }>;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const t = useTranslations("rules");
  const count = preview.reduce((total, group) => total + group.transactionIds.length, 0);
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("bulkPreview.title")}</DialogTitle>
          <DialogDescription>{t("bulkPreview.description")}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : count === 0 ? (
          <p className="text-sm text-muted-foreground">{t("bulkPreview.empty")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {preview.map((group) => (
              <li key={group.categoryId} className="flex justify-between px-3 py-2 text-sm">
                <span>{categoryById.get(group.categoryId)?.name ?? t("unknownCategory")}</span>
                <span className="text-muted-foreground">
                  {t("bulkPreview.count", { count: group.transactionIds.length })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={loading || pending || count === 0}
            onClick={() => void onConfirm()}
          >
            {pending ? t("saving") : t("bulkPreview.confirm", { count })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleForm({
  rule,
  categories,
  open,
  pending,
  onClose,
  onSave,
}: {
  rule: CategorizationRule | null;
  categories: { id: string; name: string; kind: string }[];
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (draft: Draft) => Promise<void>;
}) {
  const t = useTranslations("rules");
  const [draft, setDraft] = useState(() => toDraft(rule));
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.categoryId || !draft.matchPattern.trim() || !/[^%_\s]/.test(draft.matchPattern))
      return setError(t("form.invalid"));
    setError(null);
    try {
      await onSave({ ...draft, matchPattern: draft.matchPattern.trim() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("saveError"));
    }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rule ? t("editTitle") : t("newTitle")}</DialogTitle>
          <DialogDescription>{t("formDescription")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="rule-pattern">{t("form.pattern")}</Label>
            <Input
              id="rule-pattern"
              value={draft.matchPattern}
              maxLength={200}
              onChange={(event) =>
                setDraft((value) => ({ ...value, matchPattern: event.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">{t("form.patternHint")}</p>
          </div>
          <div className="space-y-2">
            <Label>{t("form.category")}</Label>
            <Select
              value={draft.categoryId}
              onValueChange={(categoryId) => setDraft((value) => ({ ...value, categoryId }))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("form.categoryPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-priority">{t("form.priority")}</Label>
            <Input
              id="rule-priority"
              type="number"
              value={draft.priority}
              onChange={(event) =>
                setDraft((value) => ({ ...value, priority: Number(event.target.value) }))
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
