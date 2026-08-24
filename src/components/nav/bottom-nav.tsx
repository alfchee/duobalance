"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Wallet,
  ArrowLeftRight,
  PieChart,
  Receipt,
  BarChart3,
  HelpCircle,
  LogOut,
  Menu,
  Plus,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTransactionsUiStore } from "@/store/transactions";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuthCommands } from "@/hooks/useAuthCommands";

const ITEMS = [
  { href: "/balances", labelKey: "balances", Icon: Wallet },
  { href: "/transactions", labelKey: "transactions", Icon: ArrowLeftRight },
  { href: "/budget", labelKey: "budget", Icon: PieChart },
  { href: "/reports", labelKey: "reports", Icon: BarChart3 },
  { href: "/bills", labelKey: "bills", Icon: Receipt },
  { href: "/settings", labelKey: "settings", Icon: Settings },
  { href: "/help", labelKey: "help", Icon: HelpCircle },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const { logout } = useAuthCommands();
  const openCreate = useTransactionsUiStore((state) => state.openCreate);
  const [open, setOpen] = useState(false);

  async function handleLogout() {
    await logout();
    window.location.assign("/login");
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="icon"
        aria-label={t("more")}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="nav-menu-attention fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 z-40 size-14 rounded-full bg-primary text-primary-foreground shadow-raised hover:bg-primary/80 active:scale-95 md:hidden"
      >
        <Menu className="size-6" />
      </Button>
      <Button
        type="button"
        aria-label={t("newTransaction")}
        onClick={() => openCreate()}
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 min-h-14 rounded-full px-5 shadow-raised md:hidden"
      >
        <Plus className="size-5" />
        {t("newTransaction")}
      </Button>
      <SheetContent side="left" className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-4 md:hidden">
        <SheetHeader className="border-b px-2 pb-5 pt-1">
          <SheetTitle className="flex items-center gap-2 text-xl font-black tracking-tight">
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-2xl bg-primary text-sm font-black text-primary-foreground"
            >
              db
            </span>
            DuoBalance
          </SheetTitle>
          <SheetDescription className="sr-only">{t("more")}</SheetDescription>
        </SheetHeader>
        <nav className="min-h-0 flex-1 overflow-y-auto py-4" aria-label={t("more")}>
          <ul className="space-y-2">
            {ITEMS.map(({ href, labelKey, Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-full px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-primary/35 text-primary-foreground"
                        : "text-foreground hover:bg-secondary",
                    )}
                  >
                    <Icon className="size-5" />
                    {t(labelKey)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => void handleLogout()}
            className="min-h-12 w-full justify-start rounded-full text-muted-foreground hover:text-foreground"
          >
            <LogOut className="size-5" />
            {t("logout")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
