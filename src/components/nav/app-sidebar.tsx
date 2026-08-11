"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, LogOut, MoreHorizontal, PieChart, Receipt, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { createSupabaseBrowser } from "@/lib/supabase/client";

const ITEMS = [
  { href: "/balances", labelKey: "balances", Icon: Wallet },
  { href: "/transactions", labelKey: "transactions", Icon: ArrowLeftRight },
  { href: "/budget", labelKey: "budget", Icon: PieChart },
  { href: "/bills", labelKey: "bills", Icon: Receipt },
  { href: "/settings", labelKey: "more", Icon: MoreHorizontal },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("nav");

  async function handleLogout() {
    const supabase = createSupabaseBrowser();
    await supabase?.auth.signOut();
    router.replace("/login");
  }

  return (
    <aside className="sticky top-0 hidden h-dvh w-65 shrink-0 flex-col border-r bg-background p-4 md:flex">
      <Link
        href="/balances"
        className="mb-8 flex items-center gap-2 px-2 text-xl font-black tracking-tight"
      >
        <span className="flex size-8 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Wallet className="size-4" />
        </span>
        duobalance
      </Link>
      <nav aria-label={t("more")}>
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
      <button
        type="button"
        onClick={handleLogout}
        className="mt-auto flex items-center gap-3 rounded-full px-4 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut className="size-5" />
        {t("logout")}
      </button>
    </aside>
  );
}
