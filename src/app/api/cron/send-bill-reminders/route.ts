// GET /api/cron/send-bill-reminders — daily reminder emails for due bills (#33).
// Fired by the Vercel cron job (vercel.json). Auth pattern matches fx-refresh.
//
// `revalidate = 0` satisfies the Tauri static-export build without Next
// stripping cookies/headers/searchParams from real requests — see
// cron/fx-refresh/route.ts for why `dynamic = "force-static"` must not be used.

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { sendReminderDigest } from "@/lib/bill-reminder-email";
import type { ReminderItem } from "@/lib/bill-reminder-email";
import { sendBillReminderPush, type StoredPushSubscription } from "@/lib/web-push";

export const revalidate = 1;

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

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

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return Response.json({ error: "RESEND_API_KEY not configured" }, { status: 502 });
  }

  const supabase = await createSupabaseRouteHandler();

  try {
    // Fetch instances due for reminder using the SQL helper function
    const rpc = supabase.rpc as unknown as (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>;

    const { data: reminderRows, error: reminderError } = await rpc(
      "bill_instances_due_for_reminder",
    );

    if (reminderError) {
      console.error("send-bill-reminders: fetch failed", reminderError);
      throw new Error(`fetch reminders failed: ${String(reminderError)}`);
    }

    const items = (reminderRows ?? []) as ReminderRow[];
    if (items.length === 0) {
      return Response.json({ sent: 0, instances: 0 });
    }

    // Collect unique household and member IDs from the reminder rows
    const householdIds = new Set<string>();
    const responsibleMemberIds = new Set<string>();
    for (const item of items) {
      householdIds.add(item.household_id);
      if (item.responsible_member_id) {
        responsibleMemberIds.add(item.responsible_member_id);
      }
    }

    // Fetch all relevant members in one query
    const { data: allMembers, error: allMembersError } = await supabase
      .from("household_members")
      .select("id, user_id, display_name, household_id")
      .in("id", Array.from(responsibleMemberIds));

    if (allMembersError) {
      console.error("send-bill-reminders: member lookup failed", allMembersError);
      throw new Error(`member lookup failed: ${String(allMembersError)}`);
    }

    const memberToUserId = new Map<string, string>();
    const memberToDisplayName = new Map<string, string>();
    for (const m of allMembers ?? []) {
      memberToUserId.set(m.id, m.user_id);
      memberToDisplayName.set(m.id, m.display_name);
    }

    // Fetch all household memberships for households with joint bills in one query
    const allHouseholdIds = Array.from(householdIds);
    const { data: allHouseholdMembers, error: allHouseholdMembersError } = await supabase
      .from("household_members")
      .select("id, user_id, display_name, household_id")
      .in("household_id", allHouseholdIds);

    if (allHouseholdMembersError) {
      console.error(
        "send-bill-reminders: household member lookup failed",
        allHouseholdMembersError,
      );
      throw new Error(`household member lookup failed: ${String(allHouseholdMembersError)}`);
    }

    const householdMemberIds = new Map<
      string,
      { id: string; display_name: string; user_id: string }[]
    >();
    for (const m of allHouseholdMembers ?? []) {
      const list = householdMemberIds.get(m.household_id) ?? [];
      list.push({ id: m.id, display_name: m.display_name, user_id: m.user_id });
      householdMemberIds.set(m.household_id, list);
    }

    // Fetch user emails from auth via service role. We query only the user IDs
    // we need rather than calling listUsers() which returns every user.
    const allUserIds = new Set<string>();
    for (const m of allMembers ?? []) allUserIds.add(m.user_id);
    for (const members of householdMemberIds.values()) {
      for (const m of members) allUserIds.add(m.user_id);
    }
    const userIds = Array.from(allUserIds);

    const userIdToEmail = new Map<string, string>();
    if (userIds.length > 0) {
      // Fetch emails via a targeted SQL helper instead of listUsers(),
      // which would return every auth user. The helper is a SECURITY DEFINER
      // function in the migration; the service role can access auth.users.
      const rpc = supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;

      const { data: emailRows, error: emailRowsError } = await rpc("get_user_emails_batch", {
        p_user_ids: userIds,
      });

      if (emailRowsError) {
        console.error("send-bill-reminders: email lookup failed", emailRowsError);
        throw new Error(`email lookup failed: ${String(emailRowsError)}`);
      }

      for (const r of (emailRows ?? []) as Array<{ id: string; email: string }>) {
        if (r.email) userIdToEmail.set(r.id, r.email);
      }
    }

    const memberIds = Array.from(new Set((allHouseholdMembers ?? []).map((member) => member.id)));
    const { data: subscriptionRows, error: subscriptionError } = await supabase
      .from("push_subscriptions")
      .select("id, member_id, endpoint, p256dh, auth")
      .in("member_id", memberIds);
    if (subscriptionError) {
      console.error("send-bill-reminders: push subscription lookup failed", subscriptionError);
      throw new Error(`push subscription lookup failed: ${String(subscriptionError)}`);
    }
    const subscriptionsByMember = new Map<string, StoredPushSubscription[]>();
    for (const subscription of subscriptionRows ?? []) {
      const subscriptions = subscriptionsByMember.get(subscription.member_id) ?? [];
      subscriptions.push(subscription);
      subscriptionsByMember.set(subscription.member_id, subscriptions);
    }

    // Group by household, then by responsible member
    const grouped = new Map<
      string,
      {
        name: string;
        locale: string;
        members: Map<string, { items: ReminderItem[]; displayName: string }>;
      }
    >();

    for (const item of items) {
      let hh = grouped.get(item.household_id);
      if (!hh) {
        hh = { name: item.household_name, locale: item.household_locale, members: new Map() };
        grouped.set(item.household_id, hh);
      }
      const key = item.responsible_member_id ?? "joint";
      const entry = hh.members.get(key) ?? { items: [], displayName: "" };
      if (!hh.members.has(key)) {
        // Resolve display name for this key
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

    // Send digests and collect successful instance IDs
    let totalSent = 0;
    const succeededInstanceIds: string[] = [];

    for (const [hhId, hh] of grouped) {
      for (const [key, entry] of hh.members) {
        if (entry.items.length === 0) continue;

        // Build recipient list
        const toEmails: string[] = [];
        const recipientMemberIds: string[] = [];
        const memberInstanceIds = items
          .filter((i) =>
            key === "joint"
              ? i.household_id === hhId && i.responsible_member_id === null
              : i.responsible_member_id === key,
          )
          .map((i) => i.instance_id);

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

        // Send individually per recipient, catching each send on its own so
        // one recipient's failure doesn't stop the rest of the group from
        // being attempted (a shared try/catch around the whole loop would
        // silently skip every recipient after the first failure). Only mark
        // this group's instances as reminded once every recipient succeeds —
        // bill_instances.reminded_at is per-instance, not per-recipient, so
        // there's no way to dedup a retry for just the recipient who already
        // got it; a partial failure means the whole group is retried next run.
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

    // Only mark instances whose emails were actually sent
    if (succeededInstanceIds.length > 0) {
      const { error: updateError } = await supabase
        .from("bill_instances")
        .update({ reminded_at: new Date().toISOString() } as never)
        .in("id", succeededInstanceIds);

      if (updateError) {
        console.error("send-bill-reminders: failed to mark reminded_at", updateError);
        return Response.json(
          {
            sent: totalSent,
            instances: succeededInstanceIds.length,
            error: "failed to mark instances as reminded",
          },
          { status: 502 },
        );
      }
    }

    return Response.json({ sent: totalSent, instances: succeededInstanceIds.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("send-bill-reminders: handler failed", err);
    return Response.json({ error: `reminder sending failed: ${message}` }, { status: 502 });
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
