"use client";

import { Banknote, CreditCard, HandCoins, Landmark, PiggyBank, TrendingUp } from "lucide-react";
import type { AccountKind } from "@/lib/accounts";

const KIND_ICONS: Record<AccountKind, typeof Banknote> = {
  cash: Banknote,
  checking: Landmark,
  savings: PiggyBank,
  credit_card: CreditCard,
  loan: HandCoins,
  investment: TrendingUp,
};

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = KIND_ICONS[kind as AccountKind] ?? Banknote;
  return <Icon className={className} />;
}
