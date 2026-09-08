"use client";

import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { trackGuideOpen } from "@/lib/guide-events";

export function HelpButton({ article, className }: { article: string; className?: string }) {
  const t = useTranslations("help");
  const href = `/help/${article}`;
  return (
    <Link
      href={href}
      onClick={() => void trackGuideOpen(href, "help-button")}
      className={`inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ""}`}
      title={t("openArticle")}
      aria-label={t("openArticle")}
    >
      <HelpCircle className="size-5" />
    </Link>
  );
}
