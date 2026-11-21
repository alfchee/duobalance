// GET /api/exports/[token] — redeem a time-limited export link (#269).
//
// The token is a 256-bit hex bearer secret (24h expiry), but it is never a
// substitute for membership: the caller must still be authenticated AND an
// active member of the link's household. Unknown or malformed tokens get
// 404, cross-household callers get 403, expired links get 410. The payload
// always uses the link's minted format (a ?format override that disagrees
// gets 400 — links are format-bound).
//
// No plan re-check here by design: the mint (POST /api/exports) already
// enforced has_feature('export'), and a 24h link must survive a mid-day plan
// change the same way a downloaded file would.

// Web-only API route. Under `output: "export"` (Tauri) it is not exported at
// all — a placeholder param list satisfies the exporter without emitting
// anything for real tokens. No `dynamic` export: this route reads
// per-request auth data (see cron/fx-refresh/route.ts for why
// `dynamic = "force-static"` must not be added to such routes).
export function generateStaticParams() {
  return [{ token: "__placeholder__" }];
}

export const revalidate = 1;

import { requireUser } from "@/app/api/_shared";
import {
  EXPORT_CACHE_HEADERS,
  EXPORT_TABLES,
  ExportTooLargeError,
  fetchAllRows,
  safeFilenamePart,
  transactionsToCsv,
  type ExportData,
} from "@/app/api/export/route";
import { exportTokenSchema } from "../_shared";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (process.env.BUILD_TARGET === "tauri") {
    return Response.json({ error: "unavailable" }, { status: 401 });
  }
  if (
    (!process.env.NEXT_PUBLIC_SUPABASE_URL ||
      (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY)) &&
    process.env.NODE_ENV === "production"
  ) {
    return Response.json({ error: "not configured" }, { status: 200 });
  }

  const { token } = await params;
  if (!exportTokenSchema.safeParse(token).success) {
    return Response.json({ error: "export link not found" }, { status: 404 });
  }

  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { supabase, user } = auth;

  // Privileged lookup: RLS on data_export_links would turn a cross-household
  // token into a bare 404, hiding the deliberate 403 below. The token itself
  // is already a 256-bit secret, so resolving it server-side leaks nothing —
  // and membership is still enforced before any data is touched.
  const { createSupabaseServiceRoleClient } = await import("@/lib/supabase/server");
  const admin = createSupabaseServiceRoleClient();
  const { data: link, error: linkError } = await admin
    .from("data_export_links")
    .select("token, household_id, format, expires_at, households(id, name)")
    .eq("token", token)
    .maybeSingle();

  if (linkError) throw linkError;
  if (!link) {
    return Response.json({ error: "export link not found" }, { status: 404 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("id, households!inner(deleted_at)")
    .eq("user_id", user.id)
    .eq("household_id", link.household_id)
    .is("removed_at", null)
    .is("households.deleted_at", null)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) {
    // Covers non-members AND members of a soft-deleted household: deletion
    // revokes access immediately, so existing links die with the household.
    return Response.json({ error: "household membership required" }, { status: 403 });
  }

  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return Response.json({ error: "export link expired" }, { status: 410 });
  }

  const household = Array.isArray(link.households) ? link.households[0] : link.households;
  if (!household) {
    return Response.json({ error: "household not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? link.format;
  if (format !== link.format) {
    return Response.json({ error: "format must match the export link" }, { status: 400 });
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `duobalance-${safeFilenamePart(household.name)}-${date}`;

  if (format === "csv") {
    let transactions: unknown[];
    try {
      transactions = await fetchAllRows(supabase, "transactions", household.id);
    } catch (error) {
      if (error instanceof ExportTooLargeError) {
        return Response.json({ error: "export too large" }, { status: 413 });
      }
      console.error("export-link: failed to fetch transactions", { error });
      return Response.json({ error: "export failed" }, { status: 502 });
    }
    return new Response(transactionsToCsv(transactions as Record<string, unknown>[]), {
      headers: {
        ...EXPORT_CACHE_HEADERS,
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  }

  const data = {} as ExportData;
  try {
    const fetched = await Promise.all(
      EXPORT_TABLES.map(
        async (table) => [table, await fetchAllRows(supabase, table, household.id)] as const,
      ),
    );
    for (const [table, rows] of fetched) {
      data[table] = rows;
    }
  } catch (error) {
    if (error instanceof ExportTooLargeError) {
      return Response.json({ error: "export too large" }, { status: 413 });
    }
    console.error("export-link: failed to fetch household data", { error });
    return Response.json({ error: "export failed" }, { status: 502 });
  }

  return Response.json(
    { exported_at: new Date().toISOString(), household, data },
    {
      headers: {
        ...EXPORT_CACHE_HEADERS,
        "Content-Disposition": `attachment; filename="${filename}.json"`,
      },
    },
  );
}
