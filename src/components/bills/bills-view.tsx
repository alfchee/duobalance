"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, ReceiptText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { RRule, rrulestr } from "rrule";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { todayInHousehold } from "@/lib/dates";
import { formatMoney, parseMoneyInput, roundToMinorUnit } from "@/lib/money";
import { cn } from "@/lib/utils";

type RecurrenceKind = "monthly-day" | "monthly-last" | "weekly" | "yearly" | "monthly-interval";

type BillEditorState = {
  accountId: string;
  amount: string;
  categoryId: string;
  currency: string;
  endsOn: string;
  interval: string;
  name: string;
  reminderDays: string;
  responsibleMemberId: string;
  startsOn: string;
  recurrence: RecurrenceKind;
  weekday: string;
};

type SelectedInstance = {
  bill: BillWithInstances;
  instance: BillWithInstances["instances"][number];
};

function dateFromYmd(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function moveMonth(value: string, offset: number): string {
  const date = dateFromYmd(value);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function monthBounds(month: string): { start: string; end: string } {
  const date = dateFromYmd(`${month}-01`);
  const start = date.toISOString().slice(0, 10);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return { end: date.toISOString().slice(0, 10), start };
}

function createRrule(draft: BillEditorState): string {
  const start = dateFromYmd(draft.startsOn);
  if (draft.recurrence === "monthly-last") return "FREQ=MONTHLY;BYMONTHDAY=-1";
  if (draft.recurrence === "weekly") {
    return `FREQ=WEEKLY;INTERVAL=${Math.max(1, Number(draft.interval) || 1)};BYDAY=${draft.weekday}`;
  }
  if (draft.recurrence === "yearly") {
    return `FREQ=YEARLY;BYMONTH=${start.getUTCMonth() + 1};BYMONTHDAY=${start.getUTCDate()}`;
  }
  if (draft.recurrence === "monthly-interval") {
    return `FREQ=MONTHLY;INTERVAL=${Math.max(1, Number(draft.interval) || 1)};BYMONTHDAY=${start.getUTCDate()}`;
  }
  return `FREQ=MONTHLY;BYMONTHDAY=${start.getUTCDate()}`;
}

function previewDates(draft: BillEditorState): string[] {
  if (!draft.startsOn) return [];
  try {
    const parsed = rrulestr(createRrule(draft)) as RRule;
    const rule = new RRule({ ...parsed.origOptions, dtstart: dateFromYmd(draft.startsOn) });
    const start = dateFromYmd(draft.startsOn);
    const end = dateFromYmd(draft.endsOn || "2099-12-31");
    return rule
      .between(start, end, true)
      .slice(0, 6)
      .map((date) => date.toISOString().slice(0, 10));
  } catch {
    return [];
  }
}

function defaultDraft(today: string, currency: string): BillEditorState {
  return {
    accountId: "none",
    amount: "",
    categoryId: "none",
    currency,
    endsOn: "",
    interval: "1",
    name: "",
    recurrence: "monthly-day",
    reminderDays: "3",
    responsibleMemberId: "joint",
    startsOn: today,
    weekday: "MO",
  };
}

function draftFromBill(bill: BillWithInstances): BillEditorState {
  return {
    accountId: bill.account_id ?? "none",
    amount: bill.default_amount?.toString() ?? "",
    categoryId: bill.category_id ?? "none",
    currency: bill.currency,
    endsOn: bill.ends_on ?? "",
    interval: "1",
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

function weekStart(date: string): string {
  const value = dateFromYmd(date);
  const weekday = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - ((weekday + 6) % 7));
  return value.toISOString().slice(0, 10);
}

function displayDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dateFromYmd(date));
}

function statusTone(status: string | null): string {
  if (status === "paid") return "bg-emerald-100 text-emerald-800";
  if (status === "overdue") return "bg-red-100 text-red-700";
  if (status === "skipped") return "bg-muted text-muted-foreground";
  return "bg-blue-100 text-blue-800";
}

export function BillsView() {
  const locale = useLocale();
  const t = useTranslations("bills");
  const { baseCurrency, householdId, memberId, timezone } = useHousehold();
  const today = todayInHousehold(timezone ?? "UTC");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<BillWithInstances | null>(null);
  const [selected, setSelected] = useState<SelectedInstance | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [paidByMemberId, setPaidByMemberId] = useState(memberId ?? "");
  const [createTransaction, setCreateTransaction] = useState(true);
  const [skipReason, setSkipReason] = useState("");
  const [instanceAmount, setInstanceAmount] = useState("");
  const billsQuery = useBills(householdId);
  const { data: accounts = [] } = useAccounts(householdId);
  const { data: categories = [] } = useCategories(householdId);
  const { data: currencies = [] } = useCurrencies();
  const { data: members = [] } = useHouseholdMembers(householdId);
  const { create, pay, skip, unmarkPaid, update, updateInstanceAmount } = useBillMutations(
    householdId,
    memberId,
  );
  const [draft, setDraft] = useState(() => defaultDraft(today, baseCurrency ?? "USD"));

  useEffect(() => {
    if (baseCurrency)
      setDraft((current) => ({ ...current, currency: current.currency || baseCurrency }));
  }, [baseCurrency]);

  const bounds = monthBounds(month);
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
  const instancesByDate = useMemo(() => {
    const result = new Map<string, SelectedInstance[]>();
    for (const value of monthInstances) {
      const date = value.instance.due_on!;
      result.set(date, [...(result.get(date) ?? []), value]);
    }
    return result;
  }, [monthInstances]);
  const weeks = useMemo(() => {
    const grouped = new Map<string, SelectedInstance[]>();
    for (const value of monthInstances) {
      const key = weekStart(value.instance.due_on!);
      grouped.set(key, [...(grouped.get(key) ?? []), value]);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [monthInstances]);
  const firstDay = dateFromYmd(bounds.start).getUTCDay();
  const calendarStartOffset = (firstDay + 6) % 7;
  const dayCount = Number(bounds.end.slice(-2));
  const minorUnit =
    currencies.find((currency) => currency.code === draft.currency)?.minor_unit ?? 2;
  const previews = previewDates(draft);

  const openCreate = () => {
    setEditingBill(null);
    setDraft(defaultDraft(today, baseCurrency ?? "USD"));
    setEditorOpen(true);
  };
  const openEdit = (bill: BillWithInstances) => {
    setEditingBill(bill);
    setDraft(draftFromBill(bill));
    setEditorOpen(true);
  };
  const openInstance = (value: SelectedInstance) => {
    setSkipReason("");
    setInstanceAmount(value.instance.amount?.toString() ?? "");
    setSelected(value);
  };
  const openPay = () => {
    if (!selected?.instance.amount) return;
    setAmount(selected.instance.amount.toString());
    setPaidOn(today);
    setPaidByMemberId(memberId ?? "");
    setCreateTransaction(true);
    setPayOpen(true);
  };
  const saveBill = async () => {
    const parsedAmount = draft.amount ? parseMoneyInput(draft.amount, locale) : null;
    if (!draft.name.trim() || (draft.amount && parsedAmount === null)) return;
    const payload = {
      account_id: draft.accountId === "none" ? null : draft.accountId,
      category_id: draft.categoryId === "none" ? null : draft.categoryId,
      currency: draft.currency,
      default_amount: parsedAmount === null ? null : roundToMinorUnit(parsedAmount, minorUnit),
      ends_on: draft.endsOn || null,
      name: draft.name.trim(),
      reminder_days_before: Number(draft.reminderDays) || 0,
      responsible_member_id:
        draft.responsibleMemberId === "joint" ? null : draft.responsibleMemberId,
      rrule: createRrule(draft),
      starts_on: draft.startsOn,
    };
    if (editingBill) await update.mutateAsync({ id: editingBill.id, input: payload });
    else await create.mutateAsync(payload);
    setEditorOpen(false);
  };
  const confirmPay = async () => {
    if (!selected || !paidByMemberId) return;
    const parsedAmount = parseMoneyInput(amount, locale);
    if (parsedAmount === null) return;
    await pay.mutateAsync({
      bill: selected.bill,
      input: {
        amount: roundToMinorUnit(parsedAmount, minorUnit),
        createTransaction,
        paidByMemberId,
        paidOn,
      },
      instance: selected.instance,
    });
    setPayOpen(false);
    setSelected(null);
  };
  const saveInstanceAmount = async () => {
    if (!selected?.instance.id) return;
    const parsedAmount = parseMoneyInput(instanceAmount, locale);
    if (parsedAmount === null) return;
    await updateInstanceAmount.mutateAsync({
      amount: roundToMinorUnit(parsedAmount, minorUnit),
      id: selected.instance.id,
    });
    setSelected(null);
  };

  if (billsQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-72" />
        <Skeleton className="h-36" />
      </div>
    );
  }
  if (billsQuery.isError) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p>{t("loadError")}</p>
          <Button onClick={() => void billsQuery.refetch()}>{t("retry")}</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus />
          {t("new")}
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("previousMonth")}
              onClick={() => setMonth(moveMonth(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <p className="font-semibold uppercase">
              {new Intl.DateTimeFormat(locale, {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              }).format(dateFromYmd(`${month}-01`))}
            </p>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("nextMonth")}
              onClick={() => setMonth(moveMonth(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
            {["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-y-2">
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
                  onClick={() => due[0] && openInstance(due[0])}
                  className={cn(
                    "flex min-h-11 flex-col items-center rounded-md pt-1 text-sm",
                    value === today && "bg-primary font-semibold text-primary-foreground",
                    due.length > 0 && value !== today && "hover:bg-muted",
                  )}
                >
                  <span>{day}</span>
                  <span className="mt-1 flex min-h-1.5 gap-0.5">
                    {due.slice(0, 3).map(({ bill, instance }) => (
                      <i
                        key={instance.id}
                        className="size-1.5 rounded-full"
                        style={{
                          backgroundColor:
                            members.find((member) => member.id === bill.responsible_member_id)
                              ?.color_hex ?? "var(--color-primary)",
                        }}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {bills.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <ReceiptText className="mx-auto size-8 text-muted-foreground" />
            <h2 className="font-semibold">{t("empty.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("empty.description")}</p>
            <Button onClick={openCreate}>{t("empty.action")}</Button>
          </CardContent>
        </Card>
      ) : weeks.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {t("emptyMonth")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {weeks.map(([week, items]) => (
            <section key={week}>
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-muted-foreground">
                <span>
                  {displayDate(week, locale)} –{" "}
                  {displayDate(
                    new Date(dateFromYmd(week).getTime() + 6 * 86400000).toISOString().slice(0, 10),
                    locale,
                  )}
                </span>
                <span>
                  {formatMoney(
                    items
                      .filter(({ instance }) => instance.effective_status !== "skipped")
                      .reduce((sum, { instance }) => sum + (instance.amount ?? 0), 0),
                    baseCurrency ?? "USD",
                    locale,
                  )}
                </span>
              </div>
              <Card>
                <CardContent className="divide-y p-0">
                  {items.map(({ bill, instance }) => {
                    const category = categories.find((item) => item.id === bill.category_id);
                    const paidBy = members.find(
                      (member) => member.id === instance.paid_by_member_id,
                    );
                    return (
                      <button
                        key={instance.id}
                        type="button"
                        onClick={() => openInstance({ bill, instance })}
                        className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/50"
                      >
                        <span className="grid size-9 place-items-center rounded-full bg-muted">
                          {category?.icon ?? "•"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{bill.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {displayDate(instance.due_on!, locale)}
                            {paidBy ? ` · ${paidBy.display_name}` : ""}
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
                          <span
                            className={cn(
                              "mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                              statusTone(instance.effective_status),
                            )}
                          >
                            {t(`status.${instance.effective_status ?? "due"}`)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      )}

      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingBill ? t("editor.editTitle") : t("editor.title")}</SheetTitle>
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
              <ul className="mt-2 grid grid-cols-2 gap-1 text-sm text-muted-foreground">
                {previews.map((date) => (
                  <li key={date}>{displayDate(date, locale)}</li>
                ))}
              </ul>
            </div>
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

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{selected?.bill.name}</SheetTitle>
            <SheetDescription>
              {selected?.instance.due_on ? displayDate(selected.instance.due_on, locale) : ""}
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
                        transactionId: selected.instance.paid_transaction_id,
                      })
                      .then(() => setSelected(null));
                  }}
                >
                  {t("actions.unmarkPaid")}
                </Button>
              ) : (
                <>
                  <Button className="w-full" onClick={openPay}>
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
                        .then(() => setSelected(null))
                    }
                  >
                    {t("actions.skip")}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  const bill = selected.bill;
                  setSelected(null);
                  openEdit(bill);
                }}
              >
                {t("actions.editBill")}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={payOpen} onOpenChange={setPayOpen}>
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
