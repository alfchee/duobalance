"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Wallet, ArrowLeftRight, PieChart, Receipt, MoreHorizontal, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTransactionsUiStore } from "@/store/transactions";

const ITEMS = [
  { href: "/balances", labelKey: "balances", Icon: Wallet },
  { href: "/transactions", labelKey: "transactions", Icon: ArrowLeftRight },
  { href: "/budget", labelKey: "budget", Icon: PieChart },
  { href: "/bills", labelKey: "bills", Icon: Receipt },
  { href: "/settings", labelKey: "more", Icon: MoreHorizontal },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const openCreate = useTransactionsUiStore((state) => state.openCreate);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-background">
      <ul className="mx-auto flex max-w-2xl">
        {ITEMS.map(({ href, labelKey, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 text-xs font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5" />
                {t(labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        aria-label={t("addTransaction")}
        onClick={() => openCreate()}
        className="absolute right-4 bottom-16 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Plus className="size-6" />
      </button>
    </nav>
  );
}
