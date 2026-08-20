const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  AR: "ARS",
  BO: "BOB",
  BR: "BRL",
  CL: "CLP",
  CO: "COP",
  CR: "CRC",
  CU: "CUP",
  DO: "DOP",
  EC: "USD",
  ES: "EUR",
  GT: "GTQ",
  HN: "HNL",
  MX: "MXN",
  NI: "NIO",
  PA: "PAB",
  PE: "PEN",
  PR: "USD",
  PY: "PYG",
  SV: "USD",
  US: "USD",
  UY: "UYU",
  VE: "VES",
};

const TIMEZONE_COUNTRY_MAP: Record<string, string> = {
  "America/Argentina/Buenos_Aires": "AR",
  "America/Argentina/Cordoba": "AR",
  "America/Argentina/Mendoza": "AR",
  "America/Asuncion": "PY",
  "America/Bogota": "CO",
  "America/Caracas": "VE",
  "America/Costa_Rica": "CR",
  "America/El_Salvador": "SV",
  "America/Guayaquil": "EC",
  "America/Guatemala": "GT",
  "America/Havana": "CU",
  "America/La_Paz": "BO",
  "America/Lima": "PE",
  "America/Managua": "NI",
  "America/Mexico_City": "MX",
  "America/Monterrey": "MX",
  "America/Tijuana": "MX",
  "America/Montevideo": "UY",
  "America/Panama": "PA",
  "America/Puerto_Rico": "PR",
  "America/Santiago": "CL",
  "America/Santo_Domingo": "DO",
  "America/Sao_Paulo": "BR",
  "America/Tegucigalpa": "HN",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "Europe/Madrid": "ES",
};

export function getCountryDefaultCurrency(country: string): string {
  const uppercaseCountry = country.toUpperCase();
  return COUNTRY_CURRENCY_MAP[uppercaseCountry] ?? "USD";
}

export function detectCountryFromEnvironment(
  availableCountries: readonly string[],
  environment?: { language?: string; timezone?: string },
): string | null {
  const lang =
    environment?.language ?? (typeof navigator !== "undefined" ? navigator.language : undefined);
  if (lang && lang.includes("-")) {
    const parts = lang.split("-");
    const region = parts[parts.length - 1]?.toUpperCase();
    if (region && availableCountries.includes(region)) {
      return region;
    }
  }

  const tz =
    environment?.timezone ??
    (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined);
  if (tz && TIMEZONE_COUNTRY_MAP[tz]) {
    const country = TIMEZONE_COUNTRY_MAP[tz];
    if (country && availableCountries.includes(country)) {
      return country;
    }
  }

  return null;
}

export function detectLocationDefaults(
  availableCountries: readonly string[],
  availableCurrencies: readonly string[],
  environment?: { language?: string; timezone?: string },
): { country: string | null; baseCurrency: string | null } {
  const country = detectCountryFromEnvironment(availableCountries, environment);
  if (!country) {
    return { country: null, baseCurrency: null };
  }

  const suggestedCurrency = getCountryDefaultCurrency(country);
  const baseCurrency = availableCurrencies.includes(suggestedCurrency)
    ? suggestedCurrency
    : availableCurrencies.includes("USD")
      ? "USD"
      : (availableCurrencies[0] ?? null);

  return { country, baseCurrency };
}
