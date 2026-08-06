import { notFound } from "next/navigation";
import { AcceptInviteClient } from "./accept-invite-client";

// One placeholder so the static export can prerender. The placeholder URL
// /accept-invite/__placeholder__ 404s at runtime — the real flow is reached
// by client-side navigation from an invite email and is wired up in #15.
export function generateStaticParams() {
  return [{ token: "__placeholder__" }];
}

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token === "__placeholder__") notFound();

  return <AcceptInviteClient token={token} />;
}
