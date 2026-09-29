// Shared account-deletion route helpers (#269). Server-only — under
// app/api/**, may import the service-role client. Never import from clients.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type AuditEvent =
  "account_deletion_requested" | "account_deletion_confirmed" | "account_deletion_cancelled";

/** Append one audit row per household the user belongs to (ids only, no PII). */
export async function auditAccountEvent(
  admin: SupabaseClient<Database>,
  userId: string,
  eventType: AuditEvent,
): Promise<void> {
  const { data: memberships } = await admin
    .from("household_members")
    .select("id, household_id")
    .eq("user_id", userId);

  for (const m of (memberships ?? []) as Array<{ id: string; household_id: string }>) {
    await admin.from("deletion_audit_log").insert({
      household_id: m.household_id,
      event_type: eventType,
      actor_member_id: m.id,
      target_member_id: m.id,
    });
  }
}

/** Best-effort wrapper: audit must never fail the user-facing request. */
export async function tryAudit(userId: string, eventType: AuditEvent): Promise<void> {
  try {
    const { createSupabaseServiceRoleClient } = await import("@/lib/supabase/server");
    await auditAccountEvent(createSupabaseServiceRoleClient(), userId, eventType);
  } catch (err) {
    // Ignored — audit must not break the deletion path — but logged so a
    // persistently failing audit leaves a trace instead of silent gaps.
    console.error("account-deletion: audit write failed", { userId, eventType, err });
  }
}
