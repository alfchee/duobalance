// POST /api/fx/refresh — manual "Refresh rates now" from Settings (#17).
//
// Any signed-in user can trigger a refresh: fx_rates is global reference data
// and the upsert is idempotent, so authorization is just "is a user" rather
// than "is an owner". Runs the same path as the cron endpoint (runFxRefresh);
// the CRON_SECRET stays server-side and never reaches the client.

import { createRouteContext, getAuthedUser, HttpError } from "../../_shared";
import { runFxRefresh } from "@/lib/fx/refresh";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createRouteContext();
  try {
    await getAuthedUser(supabase);
  } catch (err) {
    if (err instanceof HttpError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  try {
    const result = await runFxRefresh(createSupabaseServiceRoleClient());
    return Response.json(result);
  } catch {
    return Response.json({ error: "fx refresh failed" }, { status: 502 });
  }
}
