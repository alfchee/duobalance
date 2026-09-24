"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

export function PublicFooter() {
  const t = useTranslations("landing.footer");
  const locale = useLocale();

  return (
    <footer className="bg-foreground px-5 py-12 text-background sm:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-black">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-xs text-primary-foreground">
              db
            </span>
            DuoBalance
          </div>
          <p className="mt-4 text-sm leading-6 text-background/65">{t("description")}</p>
        </div>
        <FooterColumn
          title={t("product")}
          links={[
            { href: "/#how-it-works", label: t("howItWorks") },
            { href: "/pricing", label: t("pricing") },
            { href: "/#faq", label: t("faq") },
          ]}
        />
        <FooterColumn
          title={t("company")}
          links={[
            { href: "/#story", label: t("story") },
            { href: "/contact", label: t("contact") },
          ]}
        />
        <FooterColumn
          title={t("legal")}
          links={[
            { href: "/terms", label: t("terms") },
            { href: "/privacy", label: t("privacy") },
            { href: "/refunds", label: t("refunds") },
            {
              // pt-BR reuses Spanish legal page until dedicated pt-BR version ships (see #191).
              href: locale === "en" ? "/disclaimer" : "/aviso-legal",
              label: t("disclaimer"),
            },
          ]}
        />
      </div>
      <div className="mx-auto mt-10 max-w-7xl border-t border-background/15 pt-6 text-xs text-background/50">
        © 2026 DuoBalance
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-[0.12em]">{title}</h3>
      <div className="mt-4 grid gap-3">
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="text-sm text-background/65 transition-colors hover:text-primary"
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
