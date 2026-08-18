"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeftRight,
  BarChart3,
  HelpCircle,
  LogOut,
  MoreHorizontal,
  PieChart,
  Plus,
  Receipt,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthCommands } from "@/hooks/useAuthCommands";
import { useTransactionsUiStore } from "@/store/transactions";

const ITEMS = [
  { href: "/balances", labelKey: "balances", Icon: Wallet },
  { href: "/transactions", labelKey: "transactions", Icon: ArrowLeftRight },
  { href: "/budget", labelKey: "budget", Icon: PieChart },
  { href: "/reports", labelKey: "reports", Icon: BarChart3 },
  { href: "/bills", labelKey: "bills", Icon: Receipt },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("nav");
  const { logout } = useAuthCommands();
  const openCreate = useTransactionsUiStore((state) => state.openCreate);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <aside className="sticky top-0 hidden h-dvh w-65 shrink-0 flex-col border-r bg-background p-4 md:flex">
      <Link
        href="/balances"
        className="mb-8 flex items-center gap-2 px-2 text-xl font-black tracking-tight"
      >
        <span
          aria-hidden
          className="grid size-8 place-items-center rounded-2xl bg-primary text-sm font-black text-primary-foreground"
        >
          db
        </span>
        DuoBalance
      </Link>
      <nav aria-label={t("settings")}>
        <ul className="space-y-2">
          {ITEMS.map(({ href, labelKey, Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-full px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary/35 text-primary-foreground"
                      : "text-foreground hover:bg-secondary",
                  )}
                >
                  <Icon className={cn("size-5", active && "text-success")} />
                  {t(labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-auto space-y-4">
        <button
          type="button"
          onClick={() => openCreate()}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-ring transition-colors hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Plus className="size-5" />
          {t("newTransaction")}
        </button>
        <Link
          href="/help"
          className={cn(
            "flex items-center gap-3 rounded-full px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pathname === "/help" || pathname.startsWith("/help/")
              ? "bg-primary/35 text-primary-foreground"
              : "text-foreground hover:bg-secondary",
          )}
        >
          <HelpCircle className="size-5" />
          {t("help")}
        </Link>
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 rounded-full px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pathname === "/settings" || pathname.startsWith("/settings/")
              ? "bg-primary/35 text-primary-foreground"
              : "text-foreground hover:bg-secondary",
          )}
        >
          <MoreHorizontal className="size-5" />
          {t("settings")}
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-3 rounded-full px-4 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="size-5" />
          {t("logout")}
        </button>
      </div>
    </aside>
  );
}
