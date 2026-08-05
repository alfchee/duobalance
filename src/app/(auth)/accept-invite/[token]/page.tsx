import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// One placeholder so the static export can prerender. The placeholder URL
// /accept-invite/__placeholder__ 404s at runtime — the real flow is reached
// by client-side navigation from an invite email and is wired up in #15.
export function generateStaticParams() {
  return [{ token: "__placeholder__" }];
}

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token === "__placeholder__") notFound();

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Aceptar invitación</CardTitle>
        <CardDescription>Invite flow lands in #15.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>Placeholder screen — wired up by issue #15.</p>
        <p>
          Token: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{token}</code>
        </p>
      </CardContent>
    </Card>
  );
}
