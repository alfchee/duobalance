// Pure client-safe staleness check for the Settings warning (#17). Rate dates
// are ISO dates (YYYY-MM-DD); `today` comes from lib/dates.ts (household
// timezone) or UTC when no household is resolved. Returns null when no rates
// exist at all.
export function daysSinceNewestRate(
  rows: { rate_date: string }[] | null | undefined,
  today: string,
): number | null {
  if (!rows || rows.length === 0) return null;
  // Do not assume the rows arrive sorted — the callers' queries order desc,
  // but taking the max makes the contract explicit.
  const newest = rows.reduce(
    (max, row) => (row.rate_date > max ? row.rate_date : max),
    rows[0]!.rate_date,
  );
  return Math.max(0, Math.floor((Date.parse(today) - Date.parse(newest)) / 86_400_000));
}
