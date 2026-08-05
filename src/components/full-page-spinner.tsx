"use client";

import { Loader2 } from "lucide-react";

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-3 p-6">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      {label ? <p className="text-sm text-muted-foreground">{label}</p> : null}
    </main>
  );
}
