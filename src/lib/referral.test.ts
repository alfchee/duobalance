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

  it("handles storage throwing errors gracefully", () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
      length: 0,
      clear: () => {},
      key: () => null,
    } as unknown as Storage;

    expect(() => saveReferral(throwingStorage, "code")).not.toThrow();
    expect(() => captureReferral("?ref=code", throwingStorage)).not.toThrow();
    expect(readReferral(throwingStorage)).toBeNull();
    expect(() => clearReferral(throwingStorage)).not.toThrow();
  });
});
