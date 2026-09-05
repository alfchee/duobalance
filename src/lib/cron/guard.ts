// #160 — CRON_DISABLED guard. When the migration keeps Vercel deployed for
// 7 days as rollback, both platforms' crons would fire (twice daily). Setting
// CRON_DISABLED=true on Vercel makes every cron entry point a no-op that
// returns 200 with a clear log line, while Cloudflare (where the var is not
// set) continues to run. vercel.json stays in place so rollback is flipping
// the variable back.
//
// Intentionally returns 200 over 401 when disabled: the guard runs before
// isAuthorized so an unauthenticated caller learns the flag is set. This is
// acceptable — it avoids a Supabase call and makes the disabled state explicit
// in logs; the flag itself is not secret.
export function isCronDisabled(
  env: Record<string, unknown> = process.env as Record<string, unknown>,
): boolean {
  const v = env.CRON_DISABLED;
  if (v == null) return false;
  const s = String(v);
  return s === "1" || s.toLowerCase() === "true";
}

export function cronDisabledResponse(job: string): Response {
  console.info(`[cron] ${job} skipped — CRON_DISABLED is set`);
  return Response.json({ disabled: true, job }, { status: 200 });
}
