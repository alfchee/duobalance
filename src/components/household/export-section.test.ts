import { describe, expect, it } from "vitest";
import { downloadFilename } from "./export-section";

describe("downloadFilename", () => {
  it("matches the household backup filename contract", () => {
    expect(
      downloadFilename("Alex & Sam's Home", "json", new Date("2026-08-13T12:00:00.000Z")),
    ).toBe("duobalance-alex-sam-s-home-2026-08-13.json");
  });
});
