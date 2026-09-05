// #160 — CRON_DISABLED guard. When the migration keeps Vercel deployed for
// 7 days as rollback, both platforms' crons would fire (twice daily). Setting
// CRON_DISABLED=true on Vercel makes every cron entry point a no-op that
// returns 200 with a clear log line, while Cloudflare (where the var is not
// set) continues to run. vercel.json stays in place so rollback is flipping
// the variable back.
export function isCronDisabled(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): boolean {
  const v = env.CRON_DISABLED;
  return v === "true" || v === "1" || v?.toLowerCase() === "true";
}

export function cronDisabledResponse(job: string): Response {
  console.info(`[cron] ${job} skipped — CRON_DISABLED is set`);
  return Response.json({ disabled: true, job }, { status: 200 });
}
