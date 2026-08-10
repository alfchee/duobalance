// GET /api/cron/send-bill-reminders — daily reminder emails for due bills (#33).
// Fired by the Vercel cron job (vercel.json). Auth pattern matches fx-refresh.
//
// `dynamic = "force-static"` satisfies the Tauri static-export build.

import { createSupabaseRouteHandler } from "@/lib/supabase/server";
import { sendReminderDigest } from "@/lib/bill-reminder-email";
import type { ReminderItem } from "@/lib/bill-reminder-email";

export const dynamic = "force-static";

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
    const { data: allMembers } = await supabase
      .from("household_members")
      .select("id, user_id, display_name, household_id")
      .in("id", Array.from(responsibleMemberIds));

    const memberToUserId = new Map<string, string>();
    const memberToDisplayName = new Map<string, string>();
    if (allMembers) {
      for (const m of allMembers) {
        memberToUserId.set(m.id, m.user_id);
        memberToDisplayName.set(m.id, m.display_name);
      }
    }

    // Fetch all household memberships for households with joint bills in one query
    const allHouseholdIds = Array.from(householdIds);
    const { data: allHouseholdMembers } = await supabase
      .from("household_members")
      .select("id, user_id, display_name, household_id")
      .in("household_id", allHouseholdIds);

    const householdMemberIds = new Map<
      string,
      { id: string; display_name: string; user_id: string }[]
    >();
    if (allHouseholdMembers) {
      for (const m of allHouseholdMembers) {
        const list = householdMemberIds.get(m.household_id) ?? [];
        list.push({ id: m.id, display_name: m.display_name, user_id: m.user_id });
        householdMemberIds.set(m.household_id, list);
      }
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

      const { data: emailRows } = await rpc("get_user_emails_batch", {
        p_user_ids: userIds,
      });
      if (emailRows) {
        for (const r of emailRows as Array<{ id: string; email: string }>) {
          if (r.email) userIdToEmail.set(r.id, r.email);
        }
      }
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
            if (email) toEmails.push(email);
          }
        } else {
          const uid = memberToUserId.get(key);
          const email = uid ? userIdToEmail.get(uid) : undefined;
          if (email) toEmails.push(email);
        }

        if (toEmails.length === 0) continue;

        try {
          // Send individually per recipient rather than exposing all in To
          for (const email of toEmails) {
            await sendReminderDigest({
              to: [email],
              memberName: entry.displayName,
              householdName: hh.name,
              items: entry.items,
              locale: hh.locale,
            });
          }
          succeededInstanceIds.push(...memberInstanceIds);
          totalSent++;
        } catch (err) {
          console.error(
            `send-bill-reminders: failed to send digest for household=${hhId} member=${key}`,
            err,
          );
          // Continue with other digests; do not mark these instances as reminded
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
  if (secret) {
    return request.headers.get("authorization") === `Bearer ${secret}`;
  }
  return request.headers.get("user-agent") === "vercel-cron/1.0";
}
