import { afterEach, describe, expect, it } from "vitest";
import { cronDisabledResponse, isCronDisabled } from "./guard";

describe("isCronDisabled", () => {
  const original = process.env.CRON_DISABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_DISABLED;
    else process.env.CRON_DISABLED = original;
  });

  it("returns false when not set", () => {
    delete process.env.CRON_DISABLED;
    expect(isCronDisabled()).toBe(false);
  });

  it("returns true for 'true' and '1' (case-insensitive)", () => {
    for (const v of ["true", "True", "TRUE", "1"]) {
      process.env.CRON_DISABLED = v;
      expect(isCronDisabled()).toBe(true);
    }
  });

  it("returns false for other values", () => {
    for (const v of ["false", "0", "", "yes"]) {
      process.env.CRON_DISABLED = v;
      expect(isCronDisabled()).toBe(false);
    }
  });

  it("respects explicit env argument", () => {
    expect(isCronDisabled({ CRON_DISABLED: "true" })).toBe(true);
    expect(isCronDisabled({ CRON_DISABLED: "1" })).toBe(true);
    expect(isCronDisabled({})).toBe(false);
  });
});

describe("cronDisabledResponse", () => {
  it("returns 200 with disabled true and logs", async () => {
    const res = cronDisabledResponse("fx-refresh");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ disabled: true, job: "fx-refresh" });
  });
});
