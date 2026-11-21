// Billing clock (issue #259).
//
// No billing code reads the system clock directly: every timestamp in
// `src/lib/billing/` comes from a `Clock`. Production and the debug surface
// use `systemClock`; tests inject a `ManualClock` so a 30-day trial and a
// 7-day grace period run in milliseconds. Enforced by the `billing/clock`
// boundary in `eslint.config.mjs` (bans `Date.now()` and argument-less
// `new Date()` everywhere under `src/lib/billing/` except this file) and
// locked by `boundary.test.ts`.
//
// This module is the ONE place in billing allowed to touch the wall clock.

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class ManualClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    this.current = new Date(start.getTime());
  }

  /** A defensive copy — callers can never mutate the clock by accident. */
  now(): Date {
    return new Date(this.current.getTime());
  }

  /**
   * Move forward by ms. Negative travel is rejected: rewinding silently
   * invalidates trial/grace window assertions, so tests needing an earlier
   * time construct a fresh clock instead.
   */
  advance(ms: number): void {
    if (!Number.isFinite(ms)) {
      throw new RangeError(`advance requires a finite millisecond count (got ${ms})`);
    }
    if (ms < 0) {
      throw new RangeError(`advance requires a non-negative count (got ${ms}): no clock rewind`);
    }
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
}

/** Shared wall-clock instance for production and the debug surface. */
export const systemClock = new SystemClock();

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole-day date arithmetic in UTC (DST-blind by design for test math). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
