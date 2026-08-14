// POST /api/bills/:id/generate — immediately materialize instances for one bill.
// This is called after creating or editing a bill so the user sees instances
// right away instead of waiting for the nightly cron.

import { z } from "zod";
import { createRouteContext, getAuthedUser, HttpError } from "@/app/api/_shared";
import {
  generateInstancesForBill,
  BillGenerationError,
  type GenerationBounds,
} from "@/lib/bill-instances";

// Web-only API route. Under `output: "export"` (Tauri) it is not exported at
// all — a placeholder param list satisfies the exporter without emitting
// anything for real bill ids. No `dynamic` export: this route only has a POST
// handler, so the Tauri build already skips it — see cron/fx-refresh/route.ts
// for why `dynamic = "force-static"` must not be added to a route that reads
// real per-request auth data.
export function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

const paramsSchema = z.object({ id: z.string().uuid() });

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = paramsSchema.parse(await params);

  const supabase = await createRouteContext();
  let user;
  try {
    user = await getAuthedUser(supabase);
  } catch (err) {
    if (err instanceof HttpError)
      return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  // Fetch the bill and verify the caller is a member of its household
  const { data: bill, error: billError } = await supabase
    .from("bills")
    .select("id, household_id, default_amount, is_active")
    .eq("id", id)
    .maybeSingle();

  if (billError) throw billError;
  if (!bill) return Response.json({ error: "bill not found" }, { status: 404 });
  if (!bill.is_active) return Response.json({ error: "bill is inactive" }, { status: 400 });

  // Check membership via household_members
  const { data: membership } = await supabase
    .from("household_members")
    .select("id")
    .eq("household_id", bill.household_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return Response.json({ error: "not a member of this household" }, { status: 403 });
  }

  // Fetch generation bounds via the RPC
  const { data: boundsRaw } = await (
    supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => {
      maybeSingle: () => Promise<{ data: GenerationBounds | null; error: unknown }>;
    }
  )("bill_instance_generation_bounds", { p_bill_id: id }).maybeSingle();

  if (!boundsRaw) return Response.json({ error: "cannot generate instances" }, { status: 400 });
  const bounds = boundsRaw;

  try {
    const count = await generateInstancesForBill(supabase, bounds, bill.id, bill.household_id);
    return Response.json({ bill_id: id, inserted: count });
  } catch (err) {
    if (err instanceof BillGenerationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
