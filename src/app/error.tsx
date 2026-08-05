"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Algo salió mal</h1>
      <p className="text-sm text-muted-foreground">{error.message || "Unknown error"}</p>
      <Button onClick={() => reset()}>Reintentar</Button>
    </main>
  );
}
