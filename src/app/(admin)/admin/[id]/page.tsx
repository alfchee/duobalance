import { notFound } from "next/navigation";
import { AdminHouseholdDetailClient } from "./admin-household-detail-client";

// One placeholder so the static export can prerender. The placeholder URL
// /admin/__placeholder__ 404s at runtime — real ids resolve client-side via
// /api/admin/households?id= (same precedent as accept-invite/[token]).
export function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

export default async function AdminHouseholdDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id === "__placeholder__") notFound();

  return <AdminHouseholdDetailClient id={id} />;
}
