import { createRouteContext, getAuthedUser, HttpError } from "@/app/api/_shared";

export const dynamic = "force-static";

export function generateStaticParams() {
  return [];
}

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

type ExportTable = (typeof EXPORT_TABLES)[number];
type ExportData = Record<ExportTable, unknown[]>;

function escapeCsv(value: unknown): string {
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
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("household_id", householdId)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
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

  const data = {} as ExportData;
  for (const table of EXPORT_TABLES) {
    data[table] = await fetchAllRows(supabase, table, household.id);
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `duobalance-${safeFilenamePart(household.name)}-${date}`;
  if (format === "csv") {
    return new Response(transactionsToCsv(data.transactions as Record<string, unknown>[]), {
      headers: {
        "Content-Disposition": `attachment; filename=\"${filename}.csv\"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  }

  return Response.json(
    {
      exported_at: new Date().toISOString(),
      household,
      data,
    },
    {
      headers: {
        "Content-Disposition": `attachment; filename=\"${filename}.json\"`,
      },
    },
  );
}
