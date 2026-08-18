import { beforeEach, describe, expect, it } from "vitest";
import { captureReferral, clearReferral, readReferral, saveReferral } from "./referral";

beforeEach(() => localStorage.clear());

describe("referral", () => {
  it("captures a valid referral code", () => {
    captureReferral("?ref=blogger_2026", localStorage);

    expect(readReferral(localStorage)).toBe("blogger_2026");
  });

  it("ignores malformed referral codes", () => {
    captureReferral("?ref=not%20valid", localStorage);

    expect(readReferral(localStorage)).toBeNull();
  });

  it("clears a stored referral code", () => {
    saveReferral(localStorage, "partner");
    clearReferral(localStorage);

    expect(readReferral(localStorage)).toBeNull();
  });
});
