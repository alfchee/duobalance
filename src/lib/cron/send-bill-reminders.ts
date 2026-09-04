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
    throw new Error("RESEND_API_KEY not configured");
  }

  const rpc = supabase.rpc as unknown as (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;

  const { data: reminderRows, error: reminderError } = await rpc("bill_instances_due_for_reminder");

  if (reminderError) {
    throw new Error(`fetch reminders failed: ${String(reminderError)}`);
  }

  const items = (reminderRows ?? []) as ReminderRow[];
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
    const { data: emailRows, error: emailRowsError } = await rpc("get_user_emails_batch", {
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
  const succeededInstanceIds: string[] = [];

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

      let allSucceeded = true;
      const deadSubscriptionIds: string[] = [];
      for (const [index, email] of toEmails.entries()) {
        const recipientMemberId = recipientMemberIds[index];
        const subscriptions = recipientMemberId
          ? (subscriptionsByMember.get(recipientMemberId) ?? [])
          : [];
        let pushSent = false;
        for (const subscription of subscriptions) {
          const result = await sendBillReminderPush(subscription, entry.items.length, hh.locale);
          if (result === "gone") deadSubscriptionIds.push(subscription.id);
          if (result === "sent") pushSent = true;
        }
        if (pushSent) continue;
        try {
          await sendReminderDigest({
            to: [email],
            memberName: entry.displayName,
            householdName: hh.name,
            items: entry.items,
            locale: hh.locale,
          });
        } catch (err) {
          allSucceeded = false;
          console.error(
            `send-bill-reminders: failed to send digest for household=${hhId} member=${key} to=${email}`,
            err,
          );
        }
      }

      if (deadSubscriptionIds.length > 0) {
        const { error: pruneError } = await supabase
          .from("push_subscriptions")
          .delete()
          .in("id", deadSubscriptionIds);
        if (pruneError) {
          console.error("send-bill-reminders: failed to prune push subscriptions", pruneError);
        }
      }

      if (allSucceeded) {
        succeededInstanceIds.push(...memberInstanceIds);
        totalSent++;
      }
    }
  }

  if (succeededInstanceIds.length > 0) {
    const { error: updateError } = await supabase
      .from("bill_instances")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ reminded_at: new Date().toISOString() } as any)
      .in("id", succeededInstanceIds);

    if (updateError) {
      throw new Error(`failed to mark instances as reminded: ${String(updateError)}`);
    }
  }

  return { sent: totalSent, instances: succeededInstanceIds.length };
}
