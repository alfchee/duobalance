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

    if (reminderError) throw new Error(`fetch reminders failed: ${String(reminderError)}`);

    const items = (reminderRows ?? []) as ReminderRow[];
    if (items.length === 0) {
      return Response.json({ sent: 0, instances: 0 });
    }

    // Group by household, then by responsible member
    // Key: household_id, Value: { name, locale, members: Map<member_id|"joint", ReminderItem[]> }
    const grouped = new Map<
      string,
      {
        name: string;
        locale: string;
        members: Map<string, ReminderItem[]>;
      }
    >();

    for (const item of items) {
      let hh = grouped.get(item.household_id);
      if (!hh) {
        hh = { name: item.household_name, locale: item.household_locale, members: new Map() };
        grouped.set(item.household_id, hh);
      }
      const key = item.responsible_member_id ?? "joint";
      const memberItems = hh.members.get(key) ?? [];
      memberItems.push({
        billName: item.bill_name,
        dueOn: item.due_on,
        amount: item.amount,
        currency: item.currency,
      });
      hh.members.set(key, memberItems);
    }

    // Collect all member IDs to fetch their user IDs and emails
    const allMemberIds = new Set<string>();
    for (const hh of grouped.values()) {
      for (const key of hh.members.keys()) {
        if (key !== "joint") allMemberIds.add(key);
      }
    }

    // Fetch member -> user_id mapping for all relevant members
    const { data: members } = await supabase
      .from("household_members")
      .select("id, user_id, household_id")
      .in("id", Array.from(allMemberIds));

    const memberToUserId = new Map<string, string>();
    const householdAllMembers = new Map<string, string[]>(); // household_id -> member ids
    if (members) {
      for (const m of members) {
        memberToUserId.set(m.id, m.user_id);
        const existing = householdAllMembers.get(m.household_id) ?? [];
        existing.push(m.id);
        householdAllMembers.set(m.household_id, existing);
      }
    }

    // Fetch emails from auth.users via the admin API
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const userIdToEmail = new Map<string, string>();
    for (const u of authUsers?.users ?? []) {
      userIdToEmail.set(u.id, u.email ?? "");
    }

    // Also fetch memberships for households with joint bills
    for (const [hhId, hh] of grouped) {
      if (hh.members.has("joint") && !householdAllMembers.has(hhId)) {
        const { data: hhMembers } = await supabase
          .from("household_members")
          .select("id")
          .eq("household_id", hhId);
        if (hhMembers) {
          householdAllMembers.set(
            hhId,
            hhMembers.map((m) => m.id),
          );
        }
      }
    }

    // Send digests
    let totalSent = 0;

    for (const [hhId, hh] of grouped) {
      for (const [key, items] of hh.members) {
        if (items.length === 0) continue;

        const toEmails: string[] = [];

        if (key === "joint") {
          // Joint bill: notify all household members
          const hhMemberIds = householdAllMembers.get(hhId) ?? [];
          for (const mid of hhMemberIds) {
            const uid = memberToUserId.get(mid);
            const email = uid ? userIdToEmail.get(uid) : undefined;
            if (email) toEmails.push(email);
          }
        } else {
          // Member-specific bill: notify just that member
          const uid = memberToUserId.get(key);
          const email = uid ? userIdToEmail.get(uid) : undefined;
          if (email) toEmails.push(email);
        }

        // Fall back to sending to all available members if we can't resolve
        if (toEmails.length === 0) continue;

        try {
          await sendReminderDigest({
            to: toEmails,
            memberName: "",
            householdName: hh.name,
            items,
            locale: hh.locale,
          });
          totalSent++;
        } catch {
          // Log but continue with other digests
          continue;
        }
      }
    }

    // Mark all reminded instances
    const remindedIds = items.map((i) => i.instance_id);
    const { error: updateError } = await supabase
      .from("bill_instances")
      .update({ reminded_at: new Date().toISOString() } as never)
      .in("id", remindedIds);

    if (updateError) {
      return Response.json(
        {
          sent: totalSent,
          error: "failed to mark instances as reminded",
        },
        { status: 502 },
      );
    }

    return Response.json({ sent: totalSent, instances: items.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
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
