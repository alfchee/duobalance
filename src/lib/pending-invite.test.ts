import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingInvite,
  peekPendingInvite,
  pendingInvitePath,
  savePendingInvite,
} from "./pending-invite";

// ≥16 chars, only base64url-safe characters — a token duobalance would issue.
const VALID_TOKEN = "abc123ABC_-DEF4567890XYZ";

beforeEach(() => {
  sessionStorage.clear();
});

describe("pendingInvite", () => {
  it("round-trips a valid token through sessionStorage", () => {
    savePendingInvite(VALID_TOKEN);
    expect(peekPendingInvite()).toBe(VALID_TOKEN);
  });

  it("returns null when nothing is stored", () => {
    expect(peekPendingInvite()).toBeNull();
  });

  it("rejects tokens that are too short", () => {
    savePendingInvite("short");
    expect(peekPendingInvite()).toBeNull();
  });

  it("rejects tokens with non-base64url characters", () => {
    savePendingInvite(`abc+${"x".repeat(20)}`);
    expect(peekPendingInvite()).toBeNull();
  });

  it("builds the accept-invite path from a stored token", () => {
    savePendingInvite(VALID_TOKEN);
    expect(pendingInvitePath()).toBe(`/accept-invite/${VALID_TOKEN}`);
  });

  it("returns a null path when no valid token is stored", () => {
    expect(pendingInvitePath()).toBeNull();
  });

  it("clears the stored token", () => {
    savePendingInvite(VALID_TOKEN);
    clearPendingInvite();
    expect(peekPendingInvite()).toBeNull();
  });
});
