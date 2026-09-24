// Dunning schedule configuration (issue #265, parent epic #255).
//
// DEPENDENCY-NEUTRAL: this module imports nothing from billing — no Clock,
// no lifecycle, no Supabase types. It is the single tuning surface the
// issue notes demand ("Put the schedule in one place. Dunning timings get
// tuned later against real failure data"): the lifecycle state machine
// (#260) consumes DUNNING_GRACE_DAYS for its grace_ends_at arithmetic and
// the dunning job consumes DUNNING_SCHEDULE for stage planning and claim
// leases, so one edit changes the actual window everywhere. (Review on PR
// #287: keeping the duration in lifecycle.ts with a copy here meant editing
// the schedule alone never moved the real window.)

export type DunningStage = "first_reminder" | "second_reminder" | "final_notice";

export const DUNNING_STAGES: readonly DunningStage[] = [
  "first_reminder",
  "second_reminder",
  "final_notice",
];

/** Comped founder households (#263) never enter dunning, full stop. */
export const COMPED_PLAN_CODE = "comped";

/**
 * Dunning window granted whenever a subscription enters past_due/grace.
 * Consumed by the lifecycle (grace_ends_at arithmetic + check constraint
 * shape) and by the job below (final-notice timing) — exactly one
 * definition.
 */
export const DUNNING_GRACE_DAYS = 7;

export type DunningStatus = "past_due" | "grace";

export interface DunningStageRule {
  stage: DunningStage;
  /** Row statuses that make this stage due. */
  onStatuses: readonly DunningStatus[];
  /**
   * When set, the stage is additionally gated on urgency: only due once
   * now >= grace_ends_at - leadDays * DAY_MS (the final notice goes out
   * shortly before expiry, not on grace entry).
   */
  leadDaysBeforeGraceEnd?: number;
}

/**
 * THE schedule: stages say who is owed what and when —
 * - first_reminder: on entering past_due (immediate, catch-up in grace).
 * - second_reminder: on entering grace.
 * - final_notice: in grace, once the window is nearly over.
 *
 * claimLeaseMinutes bounds the delivery-claim lease (see dunning.ts): a
 * claim left unsent past the lease is adopted by the next run, so a crash
 * between claim and send retries the stage instead of suppressing it
 * forever.
 */
export const DUNNING_SCHEDULE: {
  graceDays: number;
  finalNoticeLeadDays: number;
  claimLeaseMinutes: number;
  stages: readonly DunningStageRule[];
} = {
  graceDays: DUNNING_GRACE_DAYS,
  finalNoticeLeadDays: 2,
  claimLeaseMinutes: 15,
  stages: [
    { stage: "first_reminder", onStatuses: ["past_due", "grace"] },
    { stage: "second_reminder", onStatuses: ["grace"] },
    { stage: "final_notice", onStatuses: ["grace"], leadDaysBeforeGraceEnd: 2 },
  ],
};
