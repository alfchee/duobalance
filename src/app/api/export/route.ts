import { createRouteContext, getAuthedUser, HttpError } from "@/app/api/_shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export const revalidate = 1;
export const dynamic = "force-dynamic";

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

type ScopeFilter = {
  removedMemberId?: string;
  removedAt?: string;
  allowedAccountIds?: string[];
};

async function fetchAllRows(
  supabase: SupabaseClient<Database>,
  table: ExportTable,
  householdId: string,
  filter?: ScopeFilter,
): Promise<unknown[]> {
  const pageSize = 1_000;
  const rows: unknown[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select("*").eq("household_id", householdId);

    // Apply cutoff filter for removed members
    if (filter?.removedAt) {
      if (
        table === "transactions" ||
        table === "categorization_rules" ||
        table === "budgets" ||
        table === "bills" ||
        table === "bill_instances" ||
        table === "import_profiles" ||
        table === "import_batches" ||
        table === "accounts" ||
        table === "categories"
      ) {
        query = query.lte("created_at", filter.removedAt);
      }
    }

    // Apply privacy filter on accounts for removed members
    if (filter?.removedMemberId && table === "accounts") {
      query = query.or(`is_shared.eq.true,owner_member_id.eq.${filter.removedMemberId}`);
    }

    // Transactions have no is_shared/owner_member_id of their own — RLS
    // normally scopes them via `account_id in (select id from accounts)`,
    // but this branch runs on the service role (RLS bypassed), so the same
    // scoping must be replicated explicitly here or a removed member's
    // export would include their ex-partner's private-account transactions.
    if (filter?.allowedAccountIds && table === "transactions") {
      query = query.in("account_id", filter.allowedAccountIds);
    }

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

  // First check using authenticated client (active membership). Filtering
  // removed_at here is required, not just an optimization: a re-invited
  // member can have both an old removed row and a fresh active row for the
  // same (user_id, household_id) pair (the partial unique index allows that
  // coexistence), and maybeSingle() throws on more than one match.
  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("id, household_id, removed_at, households(id, name, deleted_at)")
    .eq("user_id", user.id)
    .eq("household_id", householdId)
    .is("removed_at", null)
    .maybeSingle();

  let resolvedMembership = membership;
  let fetchClient: SupabaseClient<Database> = supabase;
  let scopeFilter: ScopeFilter | undefined;

  // Fallback for removed member exporting past data via service role (if available)
  if (!resolvedMembership && !membershipError) {
    try {
      const { createSupabaseServiceRoleClient } = await import("@/lib/supabase/server");
      const admin = createSupabaseServiceRoleClient();
      // Order so an active row (removed_at is null) — meaning the reason
      // the authenticated lookup above failed was a soft-deleted household,
      // not a removed membership — is preferred over a past removal.
      const { data: adminMemberships } = await admin
        .from("household_members")
        .select("id, household_id, removed_at, households(id, name, deleted_at)")
        .eq("user_id", user.id)
        .eq("household_id", householdId)
        .order("removed_at", { ascending: false, nullsFirst: true })
        .limit(1);
      const adminMembership = adminMemberships?.[0];

      if (adminMembership) {
        resolvedMembership = adminMembership;
        fetchClient = admin;
        const household = Array.isArray(adminMembership.households)
          ? adminMembership.households[0]
          : adminMembership.households;
        // Cutoff is whichever happened first: the member's own removal, or
        // the household being soft-deleted out from under an active member.
        const cutoff = adminMembership.removed_at ?? household?.deleted_at ?? undefined;

        const { data: allowedAccounts } = await admin
          .from("accounts")
          .select("id")
          .eq("household_id", householdId)
          .or(`is_shared.eq.true,owner_member_id.eq.${adminMembership.id}`);

        scopeFilter = {
          removedMemberId: adminMembership.id,
          removedAt: cutoff,
          allowedAccountIds: (allowedAccounts ?? []).map((a) => a.id),
        };
      }
    } catch {
      // Ignored if service role client is not configured
    }
  }

  if (membershipError) throw membershipError;
  if (!resolvedMembership)
    return Response.json({ error: "household membership required" }, { status: 403 });

  const household = Array.isArray(resolvedMembership.households)
    ? resolvedMembership.households[0]
    : resolvedMembership.households;

  if (!household) {
    return Response.json({ error: "household not found" }, { status: 404 });
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `duobalance-${safeFilenamePart(household.name)}-${date}`;

  if (format === "csv") {
    let transactions: unknown[];
    try {
      transactions = await fetchAllRows(fetchClient, "transactions", household.id, scopeFilter);
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
      data[table] = await fetchAllRows(fetchClient, table, household.id, scopeFilter);
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
