"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type TeachEmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  primaryLabel: string;
  onPrimary?: () => void;
  primaryHref?: string;
  guideLabel: string;
  guideHref: string;
};

export function TeachEmptyState({
  icon: Icon,
  title,
  description,
  primaryLabel,
  onPrimary,
  primaryHref,
  guideLabel,
  guideHref,
}: TeachEmptyStateProps) {
  return (
    <section className="rounded-2xl border border-dashed bg-card p-8 text-center shadow-sm">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-muted-foreground">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-xl font-black tracking-tight">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 flex flex-col items-center gap-3">
        {primaryHref ? (
          <Button asChild className="rounded-full px-8">
            <Link href={primaryHref}>{primaryLabel}</Link>
          </Button>
        ) : (
          <Button type="button" className="rounded-full px-8" onClick={onPrimary}>
            {primaryLabel}
          </Button>
        )}
        <Link
          href={guideHref}
          className="inline-flex items-center text-sm font-medium text-primary hover:underline"
        >
          {guideLabel}
        </Link>
      </div>
    </section>
  );
}
