import { describe, expect, it } from "vitest";
import {
  detectCountryFromEnvironment,
  detectLocationDefaults,
  getCountryDefaultCurrency,
} from "./defaults";

describe("household location defaults", () => {
  const availableCountries = ["NI", "CR", "MX", "CO", "CL", "US", "ES"];
  const availableCurrencies = ["NIO", "CRC", "MXN", "COP", "CLP", "USD", "EUR"];

  it("returns default currency for LATAM countries", () => {
    expect(getCountryDefaultCurrency("NI")).toBe("NIO");
    expect(getCountryDefaultCurrency("CR")).toBe("CRC");
    expect(getCountryDefaultCurrency("MX")).toBe("MXN");
    expect(getCountryDefaultCurrency("ES")).toBe("EUR");
    expect(getCountryDefaultCurrency("XX")).toBe("USD");
  });

  it("detects country from language region code", () => {
    expect(
      detectCountryFromEnvironment(availableCountries, {
        language: "es-NI",
        timezone: "UTC",
      }),
    ).toBe("NI");

    expect(
      detectCountryFromEnvironment(availableCountries, {
        language: "es-MX",
        timezone: "UTC",
      }),
    ).toBe("MX");
  });

  it("falls back to timezone when language has no region or is unmapped", () => {
    expect(
      detectCountryFromEnvironment(availableCountries, {
        language: "es",
        timezone: "America/Managua",
      }),
    ).toBe("NI");

    expect(
      detectCountryFromEnvironment(availableCountries, {
        language: "es-XX",
        timezone: "America/Costa_Rica",
      }),
    ).toBe("CR");
  });

  it("returns location defaults object matching both country and currency", () => {
    const res = detectLocationDefaults(availableCountries, availableCurrencies, {
      language: "es-NI",
      timezone: "America/Managua",
    });

    expect(res).toEqual({ country: "NI", baseCurrency: "NIO" });
  });

  it("returns nulls when country cannot be matched", () => {
    const res = detectLocationDefaults(availableCountries, availableCurrencies, {
      language: "fr",
      timezone: "Pacific/Fiji",
    });

    expect(res).toEqual({ country: null, baseCurrency: null });
  });
});
