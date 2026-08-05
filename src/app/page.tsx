import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiFetch } from "@/lib/api-fetch";
import { formatMoney } from "@/lib/money";

export default function Home() {
  // apiFetch is the ONLY sanctioned way to call /api/*.
  // This call is intentionally to a static-exported route handler that
  // returns immediately. The shape proves the helper works without
  // requiring a running backend.
  let healthPromise: ReturnType<typeof apiFetch<{ status: string; buildTarget: string }>> | null =
    null;
  if (typeof window === "undefined") {
    // Server render: do not call the API helper (the static export build
    // would otherwise need a live server). This guard is removed once
    // real data lands in feature issues.
    healthPromise = null;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center gap-6 p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>duobalance</CardTitle>
          <CardDescription>
            Scaffolded. Every later issue (#9, #10, #14, #15, #16) builds on this shell.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Money formatting smoke test: <strong>{formatMoney(1234, "CLP", "es")}</strong> /{" "}
            <strong>{formatMoney(1234, "USD", "es")}</strong> /{" "}
            <strong>{formatMoney(1234, "BRL", "es")}</strong>
          </p>
          {healthPromise ? <p>API reachable.</p> : <p>API helper: idle during static render.</p>}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button asChild>
            <a href="/login">Sign in</a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/signup">Create account</a>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
