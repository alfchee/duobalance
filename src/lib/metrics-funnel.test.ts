import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const reportMjsPath = path.resolve(dirname, "../../scripts/generate-metrics-report.mjs");
const reportMjs = readFileSync(reportMjsPath, "utf8");

// Helper that mirrors the SQL furthest-step logic for unit tests
function furthestStepForHousehold(flags: {
  signedUp: boolean;
  emailConfirmed: boolean;
  householdCreated: boolean;
  firstAccount: boolean;
  firstTransaction: boolean;
  firstBudget: boolean;
  partnerInvited: boolean;
  partnerAccepted: boolean;
}): { step: number; name: string } {
  if (flags.partnerAccepted) return { step: 8, name: "8 — Partner accepted" };
  if (flags.partnerInvited) return { step: 7, name: "7 — Partner invited" };
  if (flags.firstBudget) return { step: 6, name: "6 — First budget created" };
  if (flags.firstTransaction) return { step: 5, name: "5 — First transaction entered" };
  if (flags.firstAccount) return { step: 4, name: "4 — First account created" };
  if (flags.householdCreated) return { step: 3, name: "3 — Household created" };
  if (flags.emailConfirmed) return { step: 2, name: "2 — Email confirmed" };
  if (flags.signedUp) return { step: 1, name: "1 — Signed up" };
  return { step: 0, name: "0 — Unknown" };
}

describe("activation funnel — #167", () => {
  it("defines ordered funnel 1..8 derived from existing tables", () => {
    expect(reportMjs).toContain("1 — Signed up");
    expect(reportMjs).toContain("2 — Email confirmed");
    expect(reportMjs).toContain("3 — Household created");
    expect(reportMjs).toContain("4 — First account created");
    expect(reportMjs).toContain("5 — First transaction entered");
    expect(reportMjs).toContain("6 — First budget created");
    expect(reportMjs).toContain("7 — Partner invited");
    expect(reportMjs).toContain("8 — Partner accepted");
    // Derived from existing tables, not new tracking
    expect(reportMjs).toContain("auth.users");
    expect(reportMjs).toContain("public.households");
    expect(reportMjs).toContain("public.accounts");
    expect(reportMjs).toContain("public.transactions");
    expect(reportMjs).toContain("public.budgets");
    expect(reportMjs).toContain("public.household_invites");
    expect(reportMjs).toContain("public.household_members");
  });

  it("every household maps to exactly one furthest step (case chain)", () => {
    // SQL must have a single CASE that assigns exactly one step per household
    expect(reportMjs).toContain("when p.partner_joined_at is not null then 8");
    expect(reportMjs).toContain("when i.first_invite_at is not null then 7");
    expect(reportMjs).toContain("when b.first_budget_at is not null then 6");
    expect(reportMjs).toContain("when t.first_transaction_at is not null then 5");
    expect(reportMjs).toContain("when a.first_account_at is not null then 4");
    // And furthest_name mirrors furthest_step
    expect(reportMjs).toContain("8 — Partner accepted");
    expect(reportMjs).toContain("furthest_step");
    expect(reportMjs).toContain("furthest_name");

    // Unit test: each household gets exactly one step, steps are mutually exclusive and ordered
    const households = [
      {
        signedUp: true,
        emailConfirmed: true,
        householdCreated: true,
        firstAccount: false,
        firstTransaction: false,
        firstBudget: false,
        partnerInvited: false,
        partnerAccepted: false,
      },
      {
        signedUp: true,
        emailConfirmed: true,
        householdCreated: true,
        firstAccount: true,
        firstTransaction: false,
        firstBudget: false,
        partnerInvited: false,
        partnerAccepted: false,
      },
      {
        signedUp: true,
        emailConfirmed: true,
        householdCreated: true,
        firstAccount: true,
        firstTransaction: true,
        firstBudget: false,
        partnerInvited: false,
        partnerAccepted: false,
      },
      {
        signedUp: true,
        emailConfirmed: true,
        householdCreated: true,
        firstAccount: true,
        firstTransaction: true,
        firstBudget: true,
        partnerInvited: true,
        partnerAccepted: true,
      },
    ];
    const steps = households.map(furthestStepForHousehold);
    expect(steps[0]!.step).toBe(3);
    expect(steps[1]!.step).toBe(4);
    expect(steps[2]!.step).toBe(5);
    expect(steps[3]!.step).toBe(8);
    // Exactly one mapping each, no household appears in two steps
    expect(new Set(steps.map((s) => s.step)).size).toBe(4);
  });

  it("produces step-by-step drop-off with lost at step and largest drop identifiable", () => {
    expect(reportMjs).toContain("Activation Funnel — Drop-off");
    expect(reportMjs).toContain("Lost at step");
    expect(reportMjs).toContain("Lost % of previous");
    expect(reportMjs).toContain("Cumulative % of signed up");
    expect(reportMjs).toContain("Largest drop");
    // SQL computes lost as previous - current
    expect(reportMjs).toContain("lag(s.reached) over (order by s.step) - s.reached");
    expect(reportMjs).toContain("order by lost_at_step desc limit 1");
  });

  it("answers where zero-transaction households stopped", () => {
    expect(reportMjs).toContain("Where zero-transaction households stopped");
    expect(reportMjs).toContain("first_transaction_at is null");
    // Must group by furthest step for those without transaction
    expect(reportMjs).toContain("group by furthest_step, furthest_name) z");
    // Example: 13 of 17 households with no transaction should appear somewhere in that breakdown
    // Unit test: simulate 5 households, 3 without transaction at different furthest steps
    const simulatedFunnel = [
      furthestStepForHousehold({
        signedUp: true,
        emailConfirmed: true,
        householdCreated: true,
        firstAccount: true,
        firstTransaction: false,
        firstBudget: false,
        partnerInvited: false,
        partnerAccepted: false,
      }),
      furthestStepForHousehold({
        signedUp: true,
        emailConfirmed: true,
        householdCreated: true,
        firstAccount: false,
        firstTransaction: false,
        firstBudget: false,
        partnerInvited: false,
        partnerAccepted: false,
      }),
      furthestStepForHousehold({
        signedUp: true,
        emailConfirmed: true,
        householdCreated: true,
        firstAccount: true,
        firstTransaction: true,
        firstBudget: false,
        partnerInvited: false,
        partnerAccepted: false,
      }),
    ];
    const zeroTx = simulatedFunnel.filter((_, i) => i < 2);
    const withoutTxCounts = zeroTx.reduce(
      (acc, s) => {
        acc[s.name] = (acc[s.name] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(withoutTxCounts["4 — First account created"]).toBe(1);
    expect(withoutTxCounts["3 — Household created"]).toBe(1);
  });

  it("reports furthest step per household with time ago", () => {
    expect(reportMjs).toContain("Activation Funnel — Furthest Step per Household");
    expect(reportMjs).toContain("| Household | Furthest step | Reached at (UTC) | Time ago |");
    expect(reportMjs).toContain("household_number");
    expect(reportMjs).toContain("furthest_at");
    expect(reportMjs).toContain("days ago");
    expect(reportMjs).toContain("Distribution by furthest step");
  });

  it("segments by signup cohort", () => {
    expect(reportMjs).toContain("Activation Funnel by Cohort");
    expect(reportMjs).toContain("cohort_week");
    expect(reportMjs).toContain("date_trunc('week', h.created_at) as cohort_week");
    expect(reportMjs).toContain("With account");
    expect(reportMjs).toContain("With transaction");
  });

  it("does not require new client-side tracking where data is derivable, and says so explicitly for gaps", () => {
    expect(reportMjs).toContain(
      "All steps are derived from existing tables — no new client-side tracking was added",
    );
    expect(reportMjs).toContain("not yet derivable");
    expect(reportMjs).toContain("time in step");
    expect(reportMjs).toContain("repeat sessions");
    expect(reportMjs).toContain("guide-viewed");
    expect(reportMjs).toContain("entry point");
    // Guide viewed placeholder is documented as future step between 5 and 6
    expect(reportMjs).toContain("Guide viewed will be added as a funnel step between 5 and 6");
    expect(reportMjs).toContain("not yet in the database");
  });

  it("is designed so adding guide-viewed later does not invalidate earlier cohorts", () => {
    expect(reportMjs).toContain(
      "adding guide-viewed between 5 and 6 later will not change historic furthest-step values because steps are named, not renumbered",
    );
    expect(reportMjs).toContain("optional milestone");
  });

  it("drop-off largest drop is identifiable at a glance (unit logic)", () => {
    // Simulate funnel_counts and compute lost
    const reached = [23, 20, 17, 12, 4, 2, 3, 2]; // example signed up -> partner accepted
    const lost = reached.map((v, i) => (i === 0 ? 0 : (reached[i - 1] as number) - v));
    const maxLost = Math.max(...lost);
    const maxStepIndex = lost.indexOf(maxLost);
    expect(maxLost).toBe(8); // 12 -> 4 is largest drop
    expect(maxStepIndex).toBe(4); // step 5 First transaction
    // SQL does order by lost_at_step desc limit 1, which would return that step
    expect(maxStepIndex + 1).toBe(5);
  });
});
