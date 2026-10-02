"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { adminApiErrorMessage } from "@/components/admin/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BillingEventRow, HouseholdSummary, SubscriptionRow } from "./admin-timeline";

export type OverrideAction =
  "grant_comped" | "revoke" | "extend_trial" | "extend_grace" | "change_plan";

export type OverrideResult = {
  household: HouseholdSummary;
  subscriptions: SubscriptionRow[];
  billingEvents: BillingEventRow[];
  idempotent: boolean;
};

export const OVERRIDE_ACTION_META: Record<
  OverrideAction,
  { label: string; hint: string; needsPlan: boolean; needsExtend: boolean; needsConfirm: boolean }
> = {
  grant_comped: {
    label: "Grant comped plan",
    hint: "Provisions a perpetual founder plan. Fails if a live subscription already exists.",
    needsPlan: false,
    needsExtend: false,
    needsConfirm: false,
  },
  extend_trial: {
    label: "Extend trial",
    hint: "Sets the trial window to an absolute date. Repeating the same date changes nothing.",
    needsPlan: false,
    needsExtend: true,
    needsConfirm: false,
  },
  extend_grace: {
    label: "Extend grace period",
    hint: "Sets the dunning window to an absolute date. Repeating the same date changes nothing.",
    needsPlan: false,
    needsExtend: true,
    needsConfirm: false,
  },
  change_plan: {
    label: "Change plan",
    hint: "Moves the live subscription onto another plan code. Moving onto comped clears the windows.",
    needsPlan: true,
    needsExtend: false,
    needsConfirm: false,
  },
  revoke: {
    label: "Revoke entitlement",
    hint: "Expires the live subscription immediately. This removes access and cannot be undone here.",
    needsPlan: false,
    needsExtend: false,
    needsConfirm: true,
  },
};

function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `key-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

// Plan overrides and comp grants (#273): the operational escape hatch.
// Every action needs a recorded reason (the server rejects the call
// without one), revokes need the explicit confirmation checkbox, and the
// result replaces the detail state in place — the operator sees what the
// override did with no reload. Double-clicks are safe twice over: the
// submit button disables while the request is in flight, and the request
// carries an idempotency key the server replays with zero state touch.
export function AdminOverridePanel({
  householdId,
  livePlan,
  liveStatus,
  onApplied,
}: {
  householdId: string;
  livePlan: string | null;
  liveStatus: string | null;
  onApplied: (res: OverrideResult) => void;
}) {
  const [action, setAction] = useState<OverrideAction>("grant_comped");
  const [planCode, setPlanCode] = useState("plus");
  const [extendTo, setExtendTo] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Lazy initializer: the key is minted once per mount, rotated on success.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const meta = OVERRIDE_ACTION_META[action];
  const reasonOk = reason.trim().length >= 3;
  const extendOk = !meta.needsExtend || extendTo !== "";
  const planOk = !meta.needsPlan || planCode.trim() !== "";
  const canSubmit = !pending && reasonOk && extendOk && planOk && (!meta.needsConfirm || confirm);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    // datetime-local yields "" or a parseable value through the picker, but
    // a devtools-edited string can be malformed — validate before the
    // toISOString() call throws, so the message is actionable instead of
    // the generic catch-all below.
    let extendIso: string | undefined;
    if (meta.needsExtend) {
      const at = new Date(extendTo);
      if (Number.isNaN(at.getTime())) {
        setError("Enter a valid date and time for the new window end.");
        return;
      }
      extendIso = at.toISOString();
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<OverrideResult>("/api/admin/households", {
        method: "POST",
        body: {
          household_id: householdId,
          action,
          ...(meta.needsPlan ? { plan_code: planCode.trim() } : {}),
          ...(extendIso !== undefined ? { extend_to: extendIso } : {}),
          reason: reason.trim(),
          ...(meta.needsConfirm ? { confirm } : {}),
          idempotency_key: idempotencyKey,
        },
      });
      onApplied(res);
      setNotice(
        res.idempotent
          ? "Already applied — no change was made."
          : "Applied. The resulting state is shown above.",
      );
      setIdempotencyKey(newIdempotencyKey());
      setConfirm(false);
    } catch (err) {
      setError(adminApiErrorMessage(err, "Could not apply the override."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Plan override" className="rounded-lg border border-dashed p-4">
      <h2 className="text-sm font-bold uppercase tracking-wide">Plan override</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Current: {livePlan ?? "no plan"} · {liveStatus ?? "no subscription"}. Every action is
        audited with your identity, the before/after state, and the reason below.
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="override-action">Action</Label>
          <select
            id="override-action"
            value={action}
            onChange={(e) => {
              setAction(e.target.value as OverrideAction);
              setConfirm(false);
              setError(null);
              setNotice(null);
            }}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {(Object.keys(OVERRIDE_ACTION_META) as OverrideAction[]).map((a) => (
              <option key={a} value={a}>
                {OVERRIDE_ACTION_META[a].label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{meta.hint}</p>
        </div>
        {meta.needsPlan ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="override-plan">Plan code</Label>
            <Input
              id="override-plan"
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value)}
              placeholder="free, plus, or comped"
              autoComplete="off"
            />
          </div>
        ) : null}
        {meta.needsExtend ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="override-extend">New window end</Label>
            <Input
              id="override-extend"
              type="datetime-local"
              value={extendTo}
              onChange={(e) => setExtendTo(e.target.value)}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor="override-reason">Reason (required, recorded in the audit log)</Label>
          <textarea
            id="override-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Support ticket or incident reference, e.g. comped renewal for ticket #4821"
            rows={2}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {meta.needsConfirm ? (
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I understand this removes the household&apos;s entitlement immediately. This step
              cannot be skipped.
            </span>
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        <div>
          <Button
            type="submit"
            disabled={!canSubmit}
            variant={action === "revoke" ? "destructive" : "default"}
          >
            {pending ? "Applying…" : OVERRIDE_ACTION_META[action].label}
          </Button>
        </div>
      </form>
    </section>
  );
}
