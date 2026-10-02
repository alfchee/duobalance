// Server-only: bill-reminder dispatch extracted for #155 so both the
// HTTP route handler and the Cloudflare scheduled() dispatcher can call the
// same business logic without an HTTP round-trip to self.
//
// The function takes a service-role Supabase client and returns the same
// shape the HTTP handler previously returned directly. All env reads (RESEND,
// VAPID) happen at call time so the Worker can populate process.env from
// the scheduled env before invoking this.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { sendReminderDigest, type ReminderItem } from "@/lib/bill-reminder-email";
import { sendBillReminderPush, type StoredPushSubscription } from "@/lib/web-push";

type ReminderRow = {
  instance_id: string;
  bill_id: string;
  household_id: string;
  due_on: string;
  amount: number;
  bill_name: string;
  currency: string;
  responsible_member_id: string | null;
  household_name: string;
  household_timezone: string;
  household_locale: string;
};

export type SendBillRemindersResult = {
  sent: number;
  instances: number;
};

export async function runSendBillReminders(
  supabase: SupabaseClient<Database>,
): Promise<SendBillRemindersResult> {
  if (!process.env.RESEND_API_KEY) {
    console.error("send-bill-reminders: RESEND_API_KEY not configured — aborting");
    throw new Error("RESEND_API_KEY not configured");
  }

  // NOTE (#244): always call `supabase.rpc(...)` as a bound method.
  // `SupabaseClient.rpc` reads `this.rest` internally, so extracting it via
  // `const rpc = supabase.rpc` and calling `rpc(...)` throws
  // "Cannot read properties of undefined (reading 'rest')" on the real
  // client (plain `vi.fn()` mocks hide this because they ignore `this`).
  const { data: reminderRows, error: reminderError } = await supabase.rpc(
    "bill_instances_due_for_reminder",
  );

  if (reminderError) {
    console.error("send-bill-reminders: fetch reminders failed", reminderError);
    throw new Error(`fetch reminders failed: ${String(reminderError)}`);
  }

  const items = (reminderRows ?? []) as ReminderRow[];
  console.info("send-bill-reminders: fetched reminders", {
    count: items.length,
    households: new Set(items.map((i) => i.household_id)).size,
  });
  if (items.length === 0) {
    return { sent: 0, instances: 0 };
  }

  const householdIds = new Set<string>();
  const responsibleMemberIds = new Set<string>();
  for (const item of items) {
    householdIds.add(item.household_id);
    if (item.responsible_member_id) {
      responsibleMemberIds.add(item.responsible_member_id);
    }
  }

  let allMembers: Array<{
    id: string;
    user_id: string;
    display_name: string;
    household_id: string;
  }> = [];
  if (responsibleMemberIds.size > 0) {
    const { data, error: allMembersError } = await supabase
      .from("household_members")
      .select("id, user_id, display_name, household_id")
      .in("id", Array.from(responsibleMemberIds))
      .is("removed_at", null);

    if (allMembersError) {
      throw new Error(`member lookup failed: ${String(allMembersError)}`);
    }
    allMembers = (data ?? []) as typeof allMembers;
  }

  const memberToUserId = new Map<string, string>();
  const memberToDisplayName = new Map<string, string>();
  for (const m of (allMembers ?? []) as Array<{
    id: string;
    user_id: string;
    display_name: string;
  }>) {
    memberToUserId.set(m.id, m.user_id);
    memberToDisplayName.set(m.id, m.display_name);
  }

  const allHouseholdIds = Array.from(householdIds);
  const { data: allHouseholdMembers, error: allHouseholdMembersError } = await supabase
    .from("household_members")
    .select("id, user_id, display_name, household_id")
    .in("household_id", allHouseholdIds)
    .is("removed_at", null);

  if (allHouseholdMembersError) {
    throw new Error(`household member lookup failed: ${String(allHouseholdMembersError)}`);
  }

  const householdMemberIds = new Map<
    string,
    { id: string; display_name: string; user_id: string }[]
  >();
  for (const m of (allHouseholdMembers ?? []) as Array<{
    id: string;
    user_id: string;
    display_name: string;
    household_id: string;
  }>) {
    const list = householdMemberIds.get(m.household_id) ?? [];
    list.push({ id: m.id, display_name: m.display_name, user_id: m.user_id });
    householdMemberIds.set(m.household_id, list);
  }

  const allUserIds = new Set<string>();
  for (const m of (allMembers ?? []) as Array<{ user_id: string }>) allUserIds.add(m.user_id);
  for (const members of householdMemberIds.values()) {
    for (const m of members) allUserIds.add(m.user_id);
  }
  const userIds = Array.from(allUserIds);

  const userIdToEmail = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: emailRows, error: emailRowsError } = await supabase.rpc("get_user_emails_batch", {
      p_user_ids: userIds,
    });

    if (emailRowsError) {
      throw new Error(`email lookup failed: ${String(emailRowsError)}`);
    }

    for (const r of (emailRows ?? []) as Array<{ id: string; email: string }>) {
      if (r.email) userIdToEmail.set(r.id, r.email);
    }
  }

  const memberIds = Array.from(
    new Set(((allHouseholdMembers ?? []) as Array<{ id: string }>).map((member) => member.id)),
  );
  let subscriptionRows: StoredPushSubscription[] = [];
  if (memberIds.length > 0) {
    const { data, error: subscriptionError } = await supabase
      .from("push_subscriptions")
      .select("id, member_id, endpoint, p256dh, auth")
      .in("member_id", memberIds);
    if (subscriptionError) {
      throw new Error(`push subscription lookup failed: ${String(subscriptionError)}`);
    }
    subscriptionRows = (data ?? []) as StoredPushSubscription[];
  }
  const subscriptionsByMember = new Map<string, StoredPushSubscription[]>();
  for (const subscription of (subscriptionRows ?? []) as StoredPushSubscription[]) {
    const subscriptions = subscriptionsByMember.get(subscription.member_id) ?? [];
    subscriptions.push(subscription);
    subscriptionsByMember.set(subscription.member_id, subscriptions);
  }

  const grouped = new Map<
    string,
    {
      name: string;
      locale: string;
      members: Map<string, { items: ReminderItem[]; displayName: string }>;
    }
  >();
  // Pre-index instance IDs by household+responsible key to avoid O(n²) filtering
  // inside the per-group send loop (items is scanned once, not per group).
  const instanceIdsByGroup = new Map<string, string[]>();

  for (const item of items) {
    const groupKey = `${item.household_id}:${item.responsible_member_id ?? "joint"}`;
    const bucket = instanceIdsByGroup.get(groupKey) ?? [];
    bucket.push(item.instance_id);
    instanceIdsByGroup.set(groupKey, bucket);

    let hh = grouped.get(item.household_id);
    if (!hh) {
      hh = { name: item.household_name, locale: item.household_locale, members: new Map() };
      grouped.set(item.household_id, hh);
    }
    const key = item.responsible_member_id ?? "joint";
    const entry = hh.members.get(key) ?? { items: [], displayName: "" };
    if (!hh.members.has(key)) {
      let displayName = "";
      if (key !== "joint") {
        displayName = memberToDisplayName.get(key) ?? "";
      }
      entry.displayName = displayName;
      hh.members.set(key, entry);
    }
    entry.items.push({
      billName: item.bill_name,
      dueOn: item.due_on,
      amount: item.amount,
      currency: item.currency,
    });
  }

  let totalSent = 0;
  let totalFailedGroups = 0;
  let pushFailedCount = 0;
  let pushGoneCount = 0;
  const succeededInstanceIds: string[] = [];

  // Bounded pool: serial awaits across households hit cron timeouts while
  // later groups starve, but unbounded fan-out risks Resend/push rate
  // limits. Ten in flight is the middle ground.
  const SEND_CONCURRENCY = 10;
  async function runWithConcurrency<T>(
    tasks: Array<() => Promise<T>>,
    limit: number,
  ): Promise<T[]> {
    const results: T[] = new Array(tasks.length) as T[];
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const index = next;
        next += 1;
        const task = tasks[index];
        if (task) results[index] = await task();
      }
    });
    await Promise.all(workers);
    return results;
  }

  type GroupOutcome = {
    ok: boolean;
    hhId: string;
    key: string;
    itemCount: number;
    memberInstanceIds: string[];
    deadSubscriptionIds: string[];
    pushGone: number;
    pushFailed: number;
  };

  const groupTasks: Array<() => Promise<GroupOutcome>> = [];

  for (const [hhId, hh] of grouped) {
    for (const [key, entry] of hh.members) {
      if (entry.items.length === 0) continue;

      const toEmails: string[] = [];
      const recipientMemberIds: string[] = [];
      const memberInstanceIds = instanceIdsByGroup.get(`${hhId}:${key}`) ?? [];

      if (key === "joint") {
        const hhMembers = householdMemberIds.get(hhId) ?? [];
        for (const m of hhMembers) {
          const email = userIdToEmail.get(m.user_id);
          if (email) {
            toEmails.push(email);
            recipientMemberIds.push(m.id);
          }
        }
      } else {
        const uid = memberToUserId.get(key);
        const email = uid ? userIdToEmail.get(uid) : undefined;
        if (email) {
          toEmails.push(email);
          recipientMemberIds.push(key);
        }
      }

      if (toEmails.length === 0) continue;

      const capturedEmails = [...toEmails];
      const capturedRecipientIds = [...recipientMemberIds];
      const capturedInstances = [...memberInstanceIds];
      const capturedItems = [...entry.items];
      const capturedDisplayName = entry.displayName;
      const capturedHousehold = { name: hh.name, locale: hh.locale };
      groupTasks.push(async (): Promise<GroupOutcome> => {
        let allSucceeded = true;
        const deadSubscriptionIds: string[] = [];
        let pushGone = 0;
        let pushFailed = 0;
        for (const [index, email] of capturedEmails.entries()) {
          const recipientMemberId = capturedRecipientIds[index];
          const subscriptions = recipientMemberId
            ? (subscriptionsByMember.get(recipientMemberId) ?? [])
            : [];
          // Push fan-out within one recipient is independent per
          // subscription — run together instead of serial round-trips.
          const pushResults = await Promise.all(
            subscriptions.map((subscription) =>
              sendBillReminderPush(subscription, capturedItems.length, capturedHousehold.locale),
            ),
          );
          let pushSent = false;
          pushResults.forEach((result, resultIndex) => {
            if (result === "gone") {
              const goneId = subscriptions[resultIndex]?.id;
              if (goneId) deadSubscriptionIds.push(goneId);
              pushGone++;
            } else if (result === "sent") {
              pushSent = true;
            } else {
              pushFailed++;
            }
          });
          if (pushSent) continue;
          // No push delivered (or no subscription) — fall back to email. A
          // push failure is already logged inside sendBillReminderPush so
          // Workers logs will show it even when email succeeds.
          try {
            await sendReminderDigest({
              to: [email],
              memberName: capturedDisplayName,
              householdName: capturedHousehold.name,
              items: capturedItems,
              locale: capturedHousehold.locale,
            });
          } catch (err) {
            allSucceeded = false;
            console.error(
              `send-bill-reminders: failed to send digest for household=${hhId} member=${key} recipientDomain=${email.split("@")[1] ?? "unknown"}`,
              err,
            );
          }
        }
        return {
          ok: allSucceeded,
          hhId,
          key,
          itemCount: capturedItems.length,
          memberInstanceIds: capturedInstances,
          deadSubscriptionIds,
          pushGone,
          pushFailed,
        };
      });
    }
  }

  const outcomes = await runWithConcurrency(groupTasks, SEND_CONCURRENCY);
  const allDeadSubscriptionIds: string[] = [];
  for (const outcome of outcomes) {
    pushGoneCount += outcome.pushGone;
    pushFailedCount += outcome.pushFailed;
    allDeadSubscriptionIds.push(...outcome.deadSubscriptionIds);
    if (outcome.ok) {
      succeededInstanceIds.push(...outcome.memberInstanceIds);
      totalSent++;
    } else {
      totalFailedGroups++;
      console.warn("send-bill-reminders: group delivery failed", {
        householdId: outcome.hhId,
        memberKey: outcome.key,
        itemCount: outcome.itemCount,
      });
    }
  }

  if (allDeadSubscriptionIds.length > 0) {
    const { error: pruneError } = await supabase
      .from("push_subscriptions")
      .delete()
      .in("id", Array.from(new Set(allDeadSubscriptionIds)));
    if (pruneError) {
      console.error("send-bill-reminders: failed to prune push subscriptions", pruneError);
    }
  }

  console.info("send-bill-reminders: dispatch complete", {
    totalSent,
    totalFailedGroups,
    instances: succeededInstanceIds.length,
    totalItems: items.length,
    pushGoneCount,
    pushFailedCount,
    prunedSubscriptions: pushGoneCount,
  });

  if (totalFailedGroups > 0) {
    console.error("send-bill-reminders: some reminder groups failed — check preceding logs", {
      totalFailedGroups,
      totalSent,
      instances: succeededInstanceIds.length,
    });
  }

  if (succeededInstanceIds.length > 0) {
    const { error: updateError } = await supabase
      .from("bill_instances")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ reminded_at: new Date().toISOString() } as any)
      .in("id", succeededInstanceIds);

    if (updateError) {
      console.error("send-bill-reminders: failed to mark instances as reminded", updateError);
      throw new Error(`failed to mark instances as reminded: ${String(updateError)}`);
    }
  }

  return { sent: totalSent, instances: succeededInstanceIds.length };
}
