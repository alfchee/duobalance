import { describe, expect, it } from "vitest";
import { addDays, DAY_MS, ManualClock, SystemClock } from "./clock";

const START = new Date("2026-09-23T00:00:00.000Z");

describe("SystemClock (#259)", () => {
  it("reads the wall clock with a fresh object per call", () => {
    const clock = new SystemClock();
    const before = Date.now();
    const first = clock.now();
    const second = clock.now();
    expect(first.getTime()).toBeGreaterThanOrEqual(before);
    expect(first.getTime()).toBeLessThanOrEqual(Date.now());
    expect(first).not.toBe(second);
  });
});

describe("ManualClock (#259)", () => {
  it("starts at the injected time and advances deterministically", () => {
    const clock = new ManualClock(START);
    expect(clock.now()).toEqual(START);
    clock.advance(30 * DAY_MS);
    expect(clock.now()).toEqual(new Date("2026-10-23T00:00:00.000Z"));
    clock.set(new Date("2026-09-30T12:00:00.000Z"));
    expect(clock.now()).toEqual(new Date("2026-09-30T12:00:00.000Z"));
  });

  it("returns defensive copies callers cannot mutate", () => {
    const clock = new ManualClock(START);
    clock.now().setFullYear(2000);
    expect(clock.now()).toEqual(START);
  });

  it("rejects non-finite advances", () => {
    const clock = new ManualClock(START);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
    expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("addDays does whole-day UTC arithmetic", () => {
    expect(addDays(START, 30)).toEqual(new Date("2026-10-23T00:00:00.000Z"));
    expect(addDays(START, 7)).toEqual(new Date("2026-09-30T00:00:00.000Z"));
  });
});
