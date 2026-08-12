"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Plus,
  ReceiptText,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/useAccounts";
import { useBills, useBillMutations, type BillWithInstances } from "@/hooks/useBills";
import { useCategories } from "@/hooks/useCategories";
import { useCurrencies } from "@/hooks/useCurrencies";
import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdMembers } from "@/hooks/useHouseholdMembers";
import { createBillWriteInput, parseBillAmount } from "@/lib/bills/commands";
import {
  calculateBillWeekTotal,
  createBillInstancesByDate,
  createBillStatusCounts,
  createBillWeeks,
  dateFromYmd,
  formatBillDate,
  getBillMonthWindow,
  moveBillMonth,
  type SelectedBillInstance,
} from "@/lib/bills/model";
import {
  createDefaultBillDraft,
  previewBillRecurrence,
  type BillEditorDraft,
  type RecurrenceKind,
} from "@/lib/bills/recurrence";
import { todayInHousehold } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useBillsUiStore } from "@/store/bills";

function draftFromBill(bill: BillWithInstances): BillEditorDraft {
  return {
    accountId: bill.account_id ?? "none",
    amount: bill.default_amount?.toString() ?? "",
    categoryId: bill.category_id ?? "none",
    currency: bill.currency,
    endsOn: bill.ends_on ?? "",
    interval: bill.rrule.match(/INTERVAL=(\d+)/)?.[1] ?? "1",
    name: bill.name,
    recurrence: bill.rrule.includes("BYMONTHDAY=-1")
      ? "monthly-last"
      : bill.rrule.includes("FREQ=WEEKLY")
        ? "weekly"
        : bill.rrule.includes("FREQ=YEARLY")
          ? "yearly"
          : bill.rrule.includes("INTERVAL=")
            ? "monthly-interval"
            : "monthly-day",
    reminderDays: bill.reminder_days_before.toString(),
    responsibleMemberId: bill.responsible_member_id ?? "joint",
    startsOn: bill.starts_on,
    weekday: bill.rrule.match(/BYDAY=([A-Z]{2})/)?.[1] ?? "MO",
  };
}

function statusTone(status: string | null): string {
  if (status === "paid") return "bg-success/10 text-success";
  if (status === "overdue") return "bg-destructive/10 text-destructive";
  if (status === "skipped") return "bg-muted text-muted-foreground";
  return "bg-primary/30 text-primary-foreground";
}

export function BillsView() {
  const locale = useLocale();
  const t = useTranslations("bills");
  const { baseCurrency, householdId, memberId, timezone } = useHousehold();
  const today = todayInHousehold(timezone ?? "UTC");
  const [month, setMonth] = useState(today.slice(0, 7));
  const {
    closeEditor,
    closeInstance,
    closePay,
    editorBillId,
    editorOpen,
    openCreate: openCreateEditor,
    openEdit,
    openInstance: selectInstance,
    openPay: openPaymentSheet,
    payOpen,
    selectedInstanceId,
  } = useBillsUiStore();
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [paidByMemberId, setPaidByMemberId] = useState(memberId ?? "");
  const [createTransaction, setCreateTransaction] = useState(true);
  const [skipReason, setSkipReason] = useState("");
  const [instanceAmount, setInstanceAmount] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const bounds = getBillMonthWindow(month);
  const billsQuery = useBills(householdId, bounds);
  const { data: accounts = [] } = useAccounts(householdId);
  const { data: categories = [] } = useCategories(householdId);
  const { data: currencies = [] } = useCurrencies();
  const { data: members = [] } = useHouseholdMembers(householdId);
  const { create, pay, skip, unmarkPaid, update, updateInstanceAmount } = useBillMutations(
    householdId,
    memberId,
  );
  const [draft, setDraft] = useState(() => createDefaultBillDraft(today, baseCurrency ?? "USD"));

  useEffect(() => {
    if (baseCurrency)
      setDraft((current) => ({ ...current, currency: current.currency || baseCurrency }));
  }, [baseCurrency]);

  const bills = useMemo(() => billsQuery.data ?? [], [billsQuery.data]);
  const monthInstances = useMemo(
    () =>
      bills.flatMap((bill) =>
        bill.instances
          .filter(
            (instance) =>
              instance.due_on && instance.due_on >= bounds.start && instance.due_on <= bounds.end,
          )
          .map((instance) => ({ bill, instance })),
      ),
    [bills, bounds.end, bounds.start],
  );
  const instancesByDate = useMemo(
    () => createBillInstancesByDate(monthInstances),
    [monthInstances],
  );
  const weeks = useMemo(() => createBillWeeks(monthInstances), [monthInstances]);
  const statusCounts = useMemo(() => createBillStatusCounts(monthInstances), [monthInstances]);
  const selected = useMemo(
    () => monthInstances.find(({ instance }) => instance.id === selectedInstanceId) ?? null,
    [monthInstances, selectedInstanceId],
  );
  const firstDay = dateFromYmd(bounds.start).getUTCDay();
  const calendarStartOffset = (firstDay + 6) % 7;
  const dayCount = Number(bounds.end.slice(-2));
  const minorUnitFor = (currency: string) =>
    currencies.find((c) => c.code === currency)?.minor_unit ?? 2;
  const minorUnit = minorUnitFor(draft.currency);
  const preview = previewBillRecurrence(draft);
  const previews = preview.dates;

  const beginCreate = () => {
    setDraft(createDefaultBillDraft(today, baseCurrency ?? "USD"));
    setActionError(null);
    openCreateEditor();
  };
  const beginEdit = (bill: BillWithInstances) => {
    setDraft(draftFromBill(bill));
    setActionError(null);
    openEdit(bill.id);
  };
  const beginInstance = (value: SelectedBillInstance) => {
    setSkipReason("");
    setInstanceAmount(value.instance.amount?.toString() ?? "");
    setActionError(null);
    selectInstance(value.instance.id!);
  };
  const beginPay = () => {
    if (!selected?.instance.amount) return;
    setAmount(selected.instance.amount.toString());
    setPaidOn(today);
    setPaidByMemberId(memberId ?? "");
    setCreateTransaction(true);
    setActionError(null);
    openPaymentSheet();
  };
  const saveBill = async () => {
    const result = createBillWriteInput(draft, locale, minorUnit);
    if (!result.ok) return;
    try {
      if (editorBillId) await update.mutateAsync({ id: editorBillId, input: result.value });
      else await create.mutateAsync(result.value);
      closeEditor();
    } catch {
      setActionError(t("error"));
    }
  };
  const confirmPay = async () => {
    if (!selected || !paidByMemberId) return;
    const parsedAmount = parseBillAmount(amount, locale, minorUnitFor(selected.bill.currency));
    if (parsedAmount === null) return;
    try {
      await pay.mutateAsync({
        input: {
          amount: parsedAmount,
          createTransaction,
          paidByMemberId,
          paidOn,
        },
        instance: selected.instance,
      });
      closePay();
      closeInstance();
    } catch {
      setActionError(t("error"));
    }
  };
  const saveInstanceAmount = async () => {
    if (!selected?.instance.id) return;
    const parsedAmount = parseBillAmount(
      instanceAmount,
      locale,
      minorUnitFor(selected.bill.currency),
    );
    if (parsedAmount === null) return;
    try {
      await updateInstanceAmount.mutateAsync({
        amount: parsedAmount,
        id: selected.instance.id,
      });
      closeInstance();
    } catch {
      setActionError(t("error"));
    }
  };

  if (billsQuery.isPending) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
        <Skeleton className="h-52 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
        <span className="sr-only">{t("loading")}</span>
      </div>
    );
  }
  if (billsQuery.isError) {
    return (
      <div className="rounded-4xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <CircleAlert className="mx-auto size-7 text-destructive" />
        <p className="mt-3 font-semibold text-destructive">{t("loadError")}</p>
        <Button className="mt-4" variant="outline" onClick={() => void billsQuery.refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t("eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">{t("title")}</h1>
        </div>
        <Button className="shrink-0" size="sm" onClick={beginCreate}>
          <Plus />
          {t("new")}
        </Button>
      </div>

      <section className="rounded-2xl bg-secondary p-4 sm:p-5" aria-label={t("calendarLabel")}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-black tracking-tight">
              {new Intl.DateTimeFormat(locale, {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              }).format(dateFromYmd(`${month}-01`))}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label={t("previousMonth")}
              onClick={() => setMonth(moveBillMonth(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("nextMonth")}
              onClick={() => setMonth(moveBillMonth(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 divide-x divide-border text-center">
          <div className="px-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("summary.paid")}
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-success">{statusCounts.paid}</p>
          </div>
          <div className="px-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("summary.upcoming")}
            </p>
            <p className="mt-1 text-lg font-black tabular-nums">{statusCounts.due}</p>
          </div>
          <div className="px-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("summary.overdue")}
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-destructive">
              {statusCounts.overdue}
            </p>
          </div>
        </div>
        <div className="mt-5 border-t border-border pt-4">
          <div className="grid grid-cols-7 text-center text-[10px] font-semibold tracking-wider text-muted-foreground">
            {["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-y-1">
            {Array.from({ length: calendarStartOffset }, (_, index) => (
              <span key={`blank-${index}`} />
            ))}
            {Array.from({ length: dayCount }, (_, index) => {
              const day = index + 1;
              const value = `${month}-${String(day).padStart(2, "0")}`;
              const due = instancesByDate.get(value) ?? [];
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => due[0] && beginInstance(due[0])}
                  className={cn(
                    "flex min-h-10 flex-col items-center rounded-xl pt-1 text-sm transition-colors",
                    value === today && "bg-primary font-semibold text-primary-foreground",
                    due.length > 0 && value !== today && "hover:bg-background",
                  )}
                >
                  <span>{day}</span>
                  <span className="mt-1 flex min-h-1.5 gap-0.5">
                    {due.slice(0, 3).map(({ bill, instance }) => (
                      <i
                        key={instance.id}
                        className="size-1.5 rounded-full"
                        style={{
                          backgroundColor: statusTone(instance.effective_status).includes(
                            "destructive",
                          )
                            ? "var(--destructive)"
                            : (members.find((member) => member.id === bill.responsible_member_id)
                                ?.color_hex ?? "var(--primary)"),
                        }}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {bills.length === 0 ? (
        <div className="rounded-4xl border border-dashed p-8 text-center">
          <ReceiptText className="mx-auto size-9 text-muted-foreground" />
          <h2 className="mt-4 font-black tracking-tight">{t("empty.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("empty.description")}</p>
          <Button className="mt-5" onClick={beginCreate}>
            {t("empty.action")}
          </Button>
        </div>
      ) : weeks.length === 0 ? (
        <div className="rounded-4xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <CalendarDays className="mx-auto mb-3 size-8" />
          {t("emptyMonth")}
        </div>
      ) : (
        <div className="space-y-7">
          {weeks.map(([week, items]) => (
            <section key={week}>
              <div className="mb-3 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <span className="truncate">
                  {formatBillDate(week, locale)} –{" "}
                  {formatBillDate(
                    new Date(dateFromYmd(week).getTime() + 6 * 86400000).toISOString().slice(0, 10),
                    locale,
                  )}
                </span>
                <span>{calculateBillWeekTotal(items, locale)}</span>
              </div>
              <div className="overflow-hidden rounded-2xl border bg-background shadow-ring">
                <div className="divide-y">
                  {items.map(({ bill, instance }) => {
                    const category = categories.find((item) => item.id === bill.category_id);
                    const account = accounts.find((item) => item.id === bill.account_id);
                    const paidBy = members.find(
                      (member) => member.id === instance.paid_by_member_id,
                    );
                    return (
                      <button
                        key={instance.id}
                        type="button"
                        onClick={() => beginInstance({ bill, instance })}
                        className={cn(
                          "flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-secondary/60",
                          instance.effective_status === "overdue" && "bg-destructive/5",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-10 shrink-0 place-items-center rounded-2xl bg-secondary text-lg",
                            instance.effective_status === "overdue" &&
                              "bg-destructive/10 text-destructive",
                          )}
                        >
                          {instance.effective_status === "paid" ? (
                            <Check className="size-5" />
                          ) : (
                            (category?.icon ?? "•")
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-semibold">{bill.name}</span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                statusTone(instance.effective_status),
                              )}
                            >
                              {t(`status.${instance.effective_status ?? "due"}`)}
                            </span>
                          </span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {[category?.name, account?.name, paidBy?.display_name]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="text-right">
                          <span
                            className={cn(
                              "block font-medium",
                              instance.effective_status === "paid" &&
                                "text-muted-foreground line-through",
                              instance.effective_status === "overdue" && "text-red-600",
                            )}
                          >
                            {formatMoney(instance.amount ?? 0, bill.currency, locale)}
                          </span>
                          <span className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                            <Clock3 className="size-3" />
                            {formatBillDate(instance.due_on!, locale)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      <Sheet open={editorOpen} onOpenChange={(open) => !open && closeEditor()}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editorBillId ? t("editor.editTitle") : t("editor.title")}</SheetTitle>
            <SheetDescription>{t("editor.description")}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 p-4">
            <Field label={t("editor.name")}>
              <Input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>
            <Field label={t("editor.amount")}>
              <Input
                inputMode="decimal"
                placeholder={t("editor.variableAmount")}
                value={draft.amount}
                onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
              />
            </Field>
            <Field label={t("editor.currency")}>
              <Select
                value={draft.currency}
                onValueChange={(currency) => setDraft({ ...draft, currency })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((currency) => (
                    <SelectItem key={currency.code} value={currency.code}>
                      {currency.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("editor.category")}>
              <Select
                value={draft.categoryId}
                onValueChange={(categoryId) => setDraft({ ...draft, categoryId })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("editor.none")}</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.icon} {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("editor.account")}>
              <Select
                value={draft.accountId}
                onValueChange={(accountId) => setDraft({ ...draft, accountId })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("editor.none")}</SelectItem>
                  {accounts
                    .filter((account) => !account.is_archived)
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("editor.responsible")}>
              <Select
                value={draft.responsibleMemberId}
                onValueChange={(responsibleMemberId) => setDraft({ ...draft, responsibleMemberId })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="joint">{t("editor.joint")}</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("editor.recurrence")}>
              <Select
                value={draft.recurrence}
                onValueChange={(recurrence) =>
                  setDraft({ ...draft, recurrence: recurrence as RecurrenceKind })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly-day">{t("editor.recurrences.monthlyDay")}</SelectItem>
                  <SelectItem value="monthly-last">
                    {t("editor.recurrences.monthlyLast")}
                  </SelectItem>
                  <SelectItem value="weekly">{t("editor.recurrences.weekly")}</SelectItem>
                  <SelectItem value="yearly">{t("editor.recurrences.yearly")}</SelectItem>
                  <SelectItem value="monthly-interval">
                    {t("editor.recurrences.monthlyInterval")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {(draft.recurrence === "weekly" || draft.recurrence === "monthly-interval") && (
              <Field label={t("editor.interval")}>
                <Input
                  type="number"
                  min="1"
                  value={draft.interval}
                  onChange={(event) => setDraft({ ...draft, interval: event.target.value })}
                />
              </Field>
            )}
            {draft.recurrence === "weekly" && (
              <Field label={t("editor.weekday")}>
                <Select
                  value={draft.weekday}
                  onValueChange={(weekday) => setDraft({ ...draft, weekday })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MO">{t("editor.weekdays.monday")}</SelectItem>
                    <SelectItem value="TU">{t("editor.weekdays.tuesday")}</SelectItem>
                    <SelectItem value="WE">{t("editor.weekdays.wednesday")}</SelectItem>
                    <SelectItem value="TH">{t("editor.weekdays.thursday")}</SelectItem>
                    <SelectItem value="FR">{t("editor.weekdays.friday")}</SelectItem>
                    <SelectItem value="SA">{t("editor.weekdays.saturday")}</SelectItem>
                    <SelectItem value="SU">{t("editor.weekdays.sunday")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("editor.startsOn")}>
                <Input
                  type="date"
                  value={draft.startsOn}
                  onChange={(event) => setDraft({ ...draft, startsOn: event.target.value })}
                />
              </Field>
              <Field label={t("editor.endsOn")}>
                <Input
                  type="date"
                  value={draft.endsOn}
                  onChange={(event) => setDraft({ ...draft, endsOn: event.target.value })}
                />
              </Field>
            </div>
            <Field label={t("editor.reminderDays")}>
              <Input
                type="number"
                min="0"
                max="30"
                value={draft.reminderDays}
                onChange={(event) => setDraft({ ...draft, reminderDays: event.target.value })}
              />
            </Field>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm font-medium">{t("editor.preview")}</p>
              {preview.valid ? (
                <ul className="mt-2 grid grid-cols-2 gap-1 text-sm text-muted-foreground">
                  {previews.map((date) => (
                    <li key={date}>{formatBillDate(date, locale)}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-destructive">{t("editor.invalidRecurrence")}</p>
              )}
            </div>
            {actionError ? (
              <p role="alert" className="text-sm text-destructive">
                {actionError}
              </p>
            ) : null}
          </div>
          <SheetFooter>
            <Button
              disabled={create.isPending || update.isPending || !draft.name.trim()}
              onClick={() => void saveBill()}
            >
              {create.isPending || update.isPending ? t("saving") : t("save")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && closeInstance()}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{selected?.bill.name}</SheetTitle>
            <SheetDescription>
              {selected?.instance.due_on ? formatBillDate(selected.instance.due_on, locale) : ""}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="space-y-3 p-4">
              <p className="text-2xl font-semibold">
                {formatMoney(selected.instance.amount ?? 0, selected.bill.currency, locale)}
              </p>
              {selected.instance.effective_status !== "paid" &&
                selected.instance.effective_status !== "skipped" && (
                  <div className="space-y-2">
                    <Label>{t("actions.instanceAmount")}</Label>
                    <div className="flex gap-2">
                      <Input
                        inputMode="decimal"
                        value={instanceAmount}
                        onChange={(event) => setInstanceAmount(event.target.value)}
                      />
                      <Button
                        variant="outline"
                        disabled={updateInstanceAmount.isPending}
                        onClick={() => void saveInstanceAmount()}
                      >
                        {t("actions.saveAmount")}
                      </Button>
                    </div>
                  </div>
                )}
              {selected.instance.effective_status === "paid" ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    if (
                      selected.instance.paid_transaction_id &&
                      !window.confirm(t("actions.unmarkPaidConfirm"))
                    ) {
                      return;
                    }
                    void unmarkPaid
                      .mutateAsync({
                        id: selected.instance.id!,
                      })
                      .then(closeInstance)
                      .catch(() => setActionError(t("error")));
                  }}
                >
                  {t("actions.unmarkPaid")}
                </Button>
              ) : selected.instance.effective_status === "skipped" ? (
                <p className="text-sm text-muted-foreground">{t("actions.skippedInstance")}</p>
              ) : (
                <>
                  <Button className="w-full" onClick={beginPay}>
                    {t("actions.markPaid")}
                  </Button>
                  <Input
                    placeholder={t("actions.skipReason")}
                    value={skipReason}
                    onChange={(event) => setSkipReason(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      void skip
                        .mutateAsync({
                          id: selected.instance.id!,
                          reason: skipReason.trim() || null,
                        })
                        .then(closeInstance)
                        .catch(() => setActionError(t("error")))
                    }
                  >
                    {t("actions.skip")}
                  </Button>
                </>
              )}
              {actionError ? (
                <p role="alert" className="text-sm text-destructive">
                  {actionError}
                </p>
              ) : null}
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  const bill = selected.bill;
                  closeInstance();
                  beginEdit(bill);
                }}
              >
                {t("actions.editBill")}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={payOpen} onOpenChange={(open) => !open && closePay()}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{t("pay.title")}</SheetTitle>
            <SheetDescription>{t("pay.description")}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 p-4">
            <Field label={t("pay.amount")}>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field label={t("pay.paidOn")}>
              <Input
                type="date"
                value={paidOn}
                onChange={(event) => setPaidOn(event.target.value)}
              />
            </Field>
            <Field label={t("pay.paidBy")}>
              <Select value={paidByMemberId} onValueChange={setPaidByMemberId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createTransaction}
                onChange={(event) => setCreateTransaction(event.target.checked)}
              />
              {t("pay.createTransaction")}
            </label>
            {actionError ? (
              <p role="alert" className="text-sm text-destructive">
                {actionError}
              </p>
            ) : null}
          </div>
          <SheetFooter>
            <Button disabled={pay.isPending || !paidByMemberId} onClick={() => void confirmPay()}>
              {pay.isPending ? t("saving") : t("pay.confirm")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
