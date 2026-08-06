import { describe, expect, it } from "vitest";
import { FxProviderError, parseDailyRates } from "./provider";

describe("parseDailyRates", () => {
  it("extracts conversion_rates from a success response", () => {
    const rates = parseDailyRates({
      result: "success",
      conversion_rates: { USD: 1, CLP: 950, NIO: 36.6 },
      time_last_update_utc: "Mon, 01 Jan 2024 00:00:01 +0000",
    });
    expect(rates).toEqual({ USD: 1, CLP: 950, NIO: 36.6 });
  });

  it("rejects a provider error result", () => {
    expect(() => parseDailyRates({ result: "error", "error-type": "invalid-key" })).toThrow(
      FxProviderError,
    );
  });

  it("rejects non-numeric rates", () => {
    expect(() => parseDailyRates({ result: "success", conversion_rates: { USD: "1" } })).toThrow(
      FxProviderError,
    );
  });

  it("rejects zero and negative rates", () => {
    expect(() => parseDailyRates({ result: "success", conversion_rates: { USD: 0 } })).toThrow(
      FxProviderError,
    );
    expect(() => parseDailyRates({ result: "success", conversion_rates: { USD: -1 } })).toThrow(
      FxProviderError,
    );
  });
});
