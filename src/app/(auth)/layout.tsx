import type { ReactNode } from "react";
import Link from "next/link";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-secondary/70 px-4 py-8 sm:p-8">
      <div className="flex w-full max-w-md flex-col gap-8">
        <Link
          href="/login"
          className="mx-auto inline-flex items-center gap-2 rounded-full px-3 py-2 text-xl font-black tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span
            aria-hidden
            className="grid size-9 place-items-center rounded-2xl bg-primary text-sm text-primary-foreground"
          >
            db
          </span>
          DuoBalance
        </Link>
        {children}
      </div>
    </main>
  );
}
