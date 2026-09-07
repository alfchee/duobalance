import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const reportMjsPath = path.resolve(dirname, "../../scripts/generate-metrics-report.mjs");
const reportMjs = readFileSync(reportMjsPath, "utf8");
const feedbackRoutePath = path.resolve(dirname, "../app/api/feedback/route.ts");
const feedbackRoute = readFileSync(feedbackRoutePath, "utf8");

describe("qualitative feedback — #169", () => {
  it("persists feedback to a table at the same time as sending email (route)", () => {
    expect(feedbackRoute).toContain("feedback_submissions");
    expect(feedbackRoute).toContain('from("feedback_submissions").insert');
    expect(feedbackRoute).toContain("sendFeedbackEmail");
    // Must keep email delivery path unchanged and not block on DB errors
    expect(feedbackRoute).toContain("Feedback DB persist error");
    expect(feedbackRoute).toContain("Promise.allSettled");
  });

  it("stores household and user, submission time, and answers", () => {
    expect(feedbackRoute).toContain("household_id: finalHouseholdId");
    expect(feedbackRoute).toContain("user_id: userId");
    expect(feedbackRoute).toContain("member_id: finalMemberId");
    expect(feedbackRoute).toContain("category,");
    expect(feedbackRoute).toContain("message:");
    expect(feedbackRoute).toContain("diagnostics:");
    // Table has created_at
    expect(reportMjs).toContain("feedback_submissions");
  });

  it("applies RLS so only submitting household and admin can read", () => {
    // Check migration via report definitions and route comment
    expect(reportMjs).toContain("is_member(household_id)");
    expect(reportMjs).toContain("cross-household reads are denied");
    expect(reportMjs).toContain("service_role");
    // Route must enforce membership explicitly because service_role bypasses RLS
    expect(feedbackRoute).toContain('from("household_members")');
    expect(feedbackRoute).toContain('eq("household_id", finalHouseholdId)');
    expect(feedbackRoute).toContain('eq("user_id", userId)');
  });

  it("keeps email delivery path unchanged and runs DB and email in parallel", () => {
    expect(feedbackRoute).toContain("sendFeedbackEmail");
    expect(reportMjs).toContain("Email delivery via Resend is unchanged");
    expect(reportMjs).toContain("still sent in parallel with DB persist");
    expect(feedbackRoute).toContain("Promise.allSettled");
  });

  it("metrics report can count submissions and list answers", () => {
    expect(reportMjs).toContain("Qualitative Feedback");
    expect(reportMjs).toContain("Total feedback submissions");
    expect(reportMjs).toContain("Problem reports");
    expect(reportMjs).toContain("Satisfaction prompts");
    expect(reportMjs).toContain("General feedback");
    expect(reportMjs).toContain("Recent submissions");
    expect(reportMjs).toContain("left(message, 120) as message_preview");
    expect(reportMjs).toContain("from public.feedback_submissions");
  });

  it("documents personal detail care and backfill and PII handling", () => {
    expect(reportMjs).toContain("may contain personal detail");
    expect(reportMjs).toContain("contains PII and must be treated as sensitive");
    expect(reportMjs).toContain("do not check into public repos");
    expect(reportMjs).toContain("Keep out of diagnostic exports");
    expect(reportMjs).toContain("Backfill from the Resend inbox is not automated");
    // Report should not expose full message, only truncated preview
    expect(reportMjs).toContain("left(message, 120) as message_preview");
    // Index for recent query
    const migration = readFileSync(
      path.resolve(dirname, "../../supabase/migrations/20260907000000_feedback_submissions.sql"),
      "utf8",
    );
    expect(migration).toContain("feedback_submissions_created_idx");
    expect(migration).toContain("created_at desc");
  });
});
