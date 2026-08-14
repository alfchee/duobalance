import { createRouteContext, getAuthedUser, HttpError } from "@/app/api/_shared";

// `revalidate = 1` (a positive number, not `dynamic = "force-static"`) satisfies
// the Tauri static-export build without Next stripping cookies/searchParams
// from real requests on the web build — see cron/fx-refresh/route.ts for the
// full story. `revalidate = 0` does NOT satisfy the Tauri build's check
// (`isStaticGenEnabled` requires `revalidate > 0`); reading `cookies()` here
// still makes Next render this fully dynamically per-request regardless of
// the revalidate value (verified: two requests with different session
// cookies never see each other's response).
export const revalidate = 1;

const EXPORT_TABLES = [
  "accounts",
  "transactions",
  "categories",
  "categorization_rules",
  "budgets",
  "bills",
  "bill_instances",
  "import_profiles",
  "import_batches",
  "fx_overrides",
] as const;
const EXPORT_CACHE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
};

type ExportTable = (typeof EXPORT_TABLES)[number];
type ExportData = Record<ExportTable, unknown[]>;

// Every export table has an `id` primary key except `fx_overrides`, which is
// keyed by (household_id, code, rate_date) — ordering it by "id" throws
// Postgres error 42703 ("column does not exist") and fails the whole export.
const EXPORT_ORDER_COLUMNS: Record<ExportTable, readonly string[]> = {
  accounts: ["id"],
  transactions: ["id"],
  categories: ["id"],
  categorization_rules: ["id"],
  budgets: ["id"],
  bills: ["id"],
  bill_instances: ["id"],
  import_profiles: ["id"],
  import_batches: ["id"],
  fx_overrides: ["code", "rate_date"],
};

function escapeCsv(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const raw = value == null ? "" : String(value);
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function transactionsToCsv(transactions: Record<string, unknown>[]): string {
  const fields = [
    "id",
    "occurred_on",
    "description",
    "amount",
    "currency",
    "base_amount",
    "fx_rate",
    "merchant",
    "notes",
    "account_id",
    "category_id",
    "spent_by",
    "is_cleared",
    "is_pending_review",
    "transfer_group_id",
    "created_at",
    "updated_at",
  ] as const;
  return [
    fields.join(","),
    ...transactions.map((row) => fields.map((field) => escapeCsv(row[field])).join(",")),
  ].join("\r\n");
}

function safeFilenamePart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "")
      .slice(0, 80) || "household"
  );
}

async function fetchAllRows(
  supabase: Awaited<ReturnType<typeof createRouteContext>>,
  table: ExportTable,
  householdId: string,
): Promise<unknown[]> {
  const pageSize = 1_000;
  const rows: unknown[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select("*").eq("household_id", householdId);
    for (const column of EXPORT_ORDER_COLUMNS[table]) {
      query = query.order(column, { ascending: true });
    }
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function GET(request: Request) {
  if (process.env.BUILD_TARGET === "tauri") {
    return Response.json({ error: "unavailable" }, { status: 401 });
  }
  const supabase = await createRouteContext();
  let user;
  try {
    user = await getAuthedUser(supabase);
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: "authentication required" }, { status: error.status });
    }
    throw error;
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";
  const householdId = url.searchParams.get("householdId");
  if (format !== "json" && format !== "csv") {
    return Response.json({ error: "format must be json or csv" }, { status: 400 });
  }
  if (!householdId) return Response.json({ error: "householdId is required" }, { status: 400 });

  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("household_id, households(id, name)")
    .eq("user_id", user.id)
    .eq("household_id", householdId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership)
    return Response.json({ error: "household membership required" }, { status: 403 });

  const household = membership.households;
  if (!household || Array.isArray(household)) {
    return Response.json({ error: "household not found" }, { status: 404 });
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `duobalance-${safeFilenamePart(household.name)}-${date}`;

  if (format === "csv") {
    let transactions: unknown[];
    try {
      transactions = await fetchAllRows(supabase, "transactions", household.id);
    } catch (error) {
      console.error("export: failed to fetch transactions", { householdId, error });
      return Response.json({ error: "export failed" }, { status: 502 });
    }
    return new Response(transactionsToCsv(transactions as Record<string, unknown>[]), {
      headers: {
        ...EXPORT_CACHE_HEADERS,
        "Content-Disposition": `attachment; filename=\"${filename}.csv\"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  }

  const data = {} as ExportData;
  try {
    for (const table of EXPORT_TABLES) {
      data[table] = await fetchAllRows(supabase, table, household.id);
    }
  } catch (error) {
    console.error("export: failed to fetch household data", { householdId, error });
    return Response.json({ error: "export failed" }, { status: 502 });
  }

  return Response.json(
    {
      exported_at: new Date().toISOString(),
      household,
      data,
    },
    {
      headers: {
        ...EXPORT_CACHE_HEADERS,
        "Content-Disposition": `attachment; filename=\"${filename}.json\"`,
      },
    },
  );
}
