"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  Check,
  CircleDollarSign,
  Keyboard,
  Landmark,
  ReceiptText,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { captureReferral } from "@/lib/referral";
import { cn } from "@/lib/utils";

type Showcase = "balances" | "entry" | "budget" | "bills";

const SHOWCASES: readonly Showcase[] = ["balances", "entry", "budget", "bills"];

export function LandingPage() {
  const t = useTranslations("landing");
  const [showcase, setShowcase] = useState<Showcase>("balances");

  useEffect(() => {
    captureReferral(window.location.search, localStorage);
  }, []);

  function captureCurrentReferral() {
    captureReferral(window.location.search, localStorage);
  }

  return (
    <main className="overflow-hidden">
      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2 text-lg font-black tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            db
          </span>
          DuoBalance
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild className="hidden sm:inline-flex">
            <Link href="/login">{t("nav.login")}</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup" onClick={captureCurrentReferral}>
              {t("nav.signup")}
            </Link>
          </Button>
        </div>
      </nav>

      <header className="relative isolate overflow-hidden border-b border-border bg-secondary/45">
        <Image
          src="/landing/hero.jpg"
          alt=""
          fill
          priority
          aria-hidden
          className="-z-20 object-cover object-center"
        />
        <div className="absolute inset-0 -z-10 bg-background/68 backdrop-blur-[0.5px]" />
        <div className="mx-auto flex max-w-5xl flex-col items-start px-5 py-20 text-left sm:px-8 sm:py-28">
          <div className="max-w-4xl">
            <p className=" px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground ">
              {t("hero.eyebrow")}
            </p>
            <h1 className="mt-6 max-w-4xl text-4xl font-black leading-[0.96] tracking-[-0.05em] sm:text-6xl">
              {t("hero.title")}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              {t("hero.description")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-6">
                <Link href="/signup" onClick={captureCurrentReferral}>
                  {t("hero.primaryCta")} <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-12 px-6">
                <a href="#how-it-works">{t("hero.secondaryCta")}</a>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <section id="how-it-works" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <SectionHeading eyebrow={t("showcase.eyebrow")} title={t("showcase.title")} />
        <div className="mt-10 grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
          <div role="tablist" aria-label={t("showcase.tabsLabel")} className="grid gap-2">
            {SHOWCASES.map((item, index) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={showcase === item}
                aria-controls={`showcase-${item}`}
                id={`showcase-tab-${item}`}
                onClick={() => setShowcase(item)}
                className={cn(
                  "rounded-2xl border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  showcase === item
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background hover:bg-secondary",
                )}
              >
                <span className="block text-sm font-black">
                  {index + 1}. {t(`showcase.${item}.title`)}
                </span>
                <span
                  className={cn(
                    "mt-1 block text-sm leading-6",
                    showcase === item ? "text-background/70" : "text-muted-foreground",
                  )}
                >
                  {t(`showcase.${item}.description`)}
                </span>
              </button>
            ))}
          </div>
          <ProductPreview showcase={showcase} t={t} />
        </div>
      </section>

      <section id="story" className="bg-foreground text-background">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.7fr_1.3fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
              {t("story.eyebrow")}
            </p>
            <h2 className="mt-4 text-4xl font-black leading-none tracking-[-0.04em] sm:text-5xl">
              {t("story.title")}
            </h2>
          </div>
          <div className="space-y-5 text-base leading-7 text-background/70 sm:text-lg sm:leading-8">
            <p>{t("story.first")}</p>
            <p>{t("story.second")}</p>
            <blockquote className="border-l-4 border-primary pl-5 text-xl font-bold leading-8 text-background sm:text-2xl sm:leading-9">
              {t("story.quote")}
            </blockquote>
            <p>{t("story.third")}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <SectionHeading eyebrow={t("differences.eyebrow")} title={t("differences.title")} />
        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Difference
            icon={UsersRound}
            title={t("differences.together.title")}
            description={t("differences.together.description")}
          />
          <Difference
            icon={CircleDollarSign}
            title={t("differences.currency.title")}
            description={t("differences.currency.description")}
          />
          <Difference
            icon={ShieldCheck}
            title={t("differences.privacy.title")}
            description={t("differences.privacy.description")}
          />
          <Difference
            icon={Keyboard}
            title={t("differences.manualEntry.title")}
            description={t("differences.manualEntry.description")}
          />
        </div>
      </section>

      <section className="bg-secondary/60 px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto grid max-w-7xl gap-8 rounded-[2rem] bg-background p-6 shadow-raised sm:p-10 lg:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-warning">
              {t("manual.eyebrow")}
            </p>
            <h2 className="mt-4 text-4xl font-black leading-none tracking-[-0.04em]">
              {t("manual.title")}
            </h2>
            <p className="mt-5 leading-7 text-muted-foreground">{t("manual.description")}</p>
            <p className="mt-4 leading-7 text-muted-foreground">{t("manual.descriptionTwo")}</p>
          </div>
          <div className="grid gap-4 rounded-2xl bg-secondary p-5 sm:grid-cols-2">
            <Checklist
              title={t("manual.forYouTitle")}
              items={[t("manual.forYouOne"), t("manual.forYouTwo"), t("manual.forYouThree")]}
            />
            <Checklist
              negative
              title={t("manual.notForYouTitle")}
              items={[t("manual.notForYouOne"), t("manual.notForYouTwo")]}
            />
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <SectionHeading eyebrow={t("pricing.eyebrow")} title={t("pricing.title")} />
        <div className="mx-auto mt-10 max-w-md rounded-[2rem] border border-border bg-background p-7 text-center shadow-raised">
          <p className="inline-flex rounded-full bg-primary px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-primary-foreground">
            {t("pricing.badge")}
          </p>
          <h3 className="mt-5 text-2xl font-black tracking-tight">{t("pricing.plan")}</h3>
          <p className="mt-2 text-5xl font-black tracking-[-0.05em]">{t("pricing.price")}</p>
          <p className="mt-5 leading-7 text-muted-foreground">{t("pricing.description")}</p>
          <p className="mt-5 border-t border-border pt-5 text-sm leading-6 text-muted-foreground">
            {t("pricing.future")}
          </p>
          <Button asChild size="lg" className="mt-6 w-full">
            <Link href="/signup" onClick={captureCurrentReferral}>
              {t("pricing.cta")}
            </Link>
          </Button>
        </div>
      </section>

      <section id="faq" className="bg-secondary/60 px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-3xl">
          <SectionHeading eyebrow={t("faq.eyebrow")} title={t("faq.title")} centered />
          <div className="mt-10 grid gap-3">
            {["safe", "bank", "data", "export", "currencies"].map((item) => (
              <details key={item} className="rounded-2xl bg-background p-5 shadow-ring">
                <summary className="cursor-pointer list-none pr-7 text-base font-bold marker:hidden">
                  {t(`faq.${item}.question`)}
                </summary>
                <p className="mt-3 leading-7 text-muted-foreground">{t(`faq.${item}.answer`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-foreground px-5 py-12 text-background sm:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-black">
              <span className="grid size-8 place-items-center rounded-lg bg-primary text-xs text-primary-foreground">
                db
              </span>
              DuoBalance
            </div>
            <p className="mt-4 text-sm leading-6 text-background/65">{t("footer.description")}</p>
          </div>
          <FooterLinks
            title={t("footer.product")}
            links={[
              { href: "#how-it-works", label: t("footer.howItWorks") },
              { href: "#pricing", label: t("footer.pricing") },
              { href: "#faq", label: t("footer.faq") },
            ]}
          />
          <FooterLinks
            title={t("footer.company")}
            links={[
              { href: "#story", label: t("footer.story") },
              { href: "mailto:soporte@duobalance.app", label: t("footer.contact") },
            ]}
          />
          <FooterLinks
            title={t("footer.legal")}
            links={[
              { href: "/terms", label: t("footer.terms") },
              { href: "/privacy", label: t("footer.privacy") },
            ]}
          />
        </div>
        <div className="mx-auto mt-10 max-w-7xl border-t border-background/15 pt-6 text-xs text-background/50">
          © 2026 DuoBalance
        </div>
      </footer>
    </main>
  );
}

function SectionHeading({
  eyebrow,
  title,
  centered = false,
}: {
  eyebrow: string;
  title: string;
  centered?: boolean;
}) {
  return (
    <div className={cn("max-w-2xl", centered && "mx-auto text-center")}>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {eyebrow}
      </p>
      <h2 className="mt-4 text-4xl font-black leading-none tracking-[-0.04em] sm:text-5xl">
        {title}
      </h2>
    </div>
  );
}

function Difference({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof UsersRound;
  title: string;
  description: string;
}) {
  return (
    <article className="rounded-[2rem] border border-border bg-background p-6 shadow-ring">
      <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-5 text-xl font-black tracking-tight">{title}</h3>
      <p className="mt-3 leading-7 text-muted-foreground">{description}</p>
    </article>
  );
}

function Checklist({
  title,
  items,
  negative = false,
}: {
  title: string;
  items: readonly string[];
  negative?: boolean;
}) {
  return (
    <div>
      <h3 className={cn("font-black", negative && "text-destructive")}>{title}</h3>
      <ul className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <Check
              className={cn("mt-1 size-4 shrink-0", negative ? "text-destructive" : "text-success")}
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FooterLinks({
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

function ProductPreview({
  showcase,
  t,
}: {
  showcase: Showcase;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div
      id={`showcase-${showcase}`}
      role="tabpanel"
      aria-labelledby={`showcase-tab-${showcase}`}
      className="min-h-[420px] rounded-[2rem] border border-border bg-secondary p-3 shadow-raised sm:p-5"
    >
      <div className="h-full rounded-[1.35rem] bg-background p-5 sm:p-7">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2 font-black">
            <span className="grid size-7 place-items-center rounded-lg bg-primary text-xs text-primary-foreground">
              db
            </span>
            DuoBalance
          </div>
          <div className="flex -space-x-2">
            <span className="grid size-7 place-items-center rounded-full border-2 border-background bg-secondary text-[10px] font-bold">
              AM
            </span>
            <span className="grid size-7 place-items-center rounded-full border-2 border-background bg-primary text-[10px] font-bold text-primary-foreground">
              EL
            </span>
          </div>
        </div>
        {showcase === "balances" ? <BalancesPreview t={t} /> : null}
        {showcase === "entry" ? <EntryPreview t={t} /> : null}
        {showcase === "budget" ? <BudgetPreview t={t} /> : null}
        {showcase === "bills" ? <BillsPreview t={t} /> : null}
      </div>
    </div>
  );
}

function BalancesPreview({ t }: { t: ReturnType<typeof useTranslations> }) {
  const accounts = [
    [Landmark, t("preview.jointAccount"), "$4,200.00"],
    [Banknote, t("preview.cash"), "C$ 18,325"],
    [WalletCards, t("preview.card"), "−$1,420.00"],
  ] as const;
  return (
    <div className="pt-7">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {t("preview.netWorth")}
      </p>
      <p className="mt-1 text-4xl font-black tracking-[-0.05em]">$24,530.00</p>
      <p className="mt-2 text-xs text-muted-foreground">{t("preview.exchangeRate")}</p>
      <div className="mt-7 grid gap-3">
        {accounts.map(([Icon, name, value]) => (
          <div
            key={name}
            className="flex items-center justify-between rounded-2xl border border-border p-4"
          >
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-secondary">
                <Icon className="size-4" />
              </span>
              <span className="text-sm font-bold">{name}</span>
            </div>
            <span
              className={cn("font-bold tabular-nums", value.startsWith("−") && "text-destructive")}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EntryPreview({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="pt-7">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {t("preview.newExpense")}
      </p>
      <p className="mt-2 text-4xl font-black tracking-[-0.05em]">C$ 450.00</p>
      <div className="mt-4 rounded-2xl bg-secondary p-4 text-sm leading-6">
        <p>
          <strong>{t("preview.concept")}:</strong> {t("preview.lunch")}
        </p>
        <p>
          <strong>{t("preview.account")}:</strong> {t("preview.cash")}
        </p>
        <p>
          <strong>{t("preview.category")}:</strong> {t("preview.restaurants")}
        </p>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, ".", 0, "✓"].map((key) => (
          <span
            key={key}
            className="grid h-11 place-items-center rounded-xl border border-border bg-background font-bold"
          >
            {key}
          </span>
        ))}
      </div>
    </div>
  );
}

function BudgetPreview({ t }: { t: ReturnType<typeof useTranslations> }) {
  const items = [
    [t("preview.groceries"), "80%", "bg-primary"],
    [t("preview.fuel"), "90%", "bg-success"],
    [t("preview.fun"), "100%", "bg-destructive"],
  ] as const;
  return (
    <div className="pt-7">
      <div className="flex items-center gap-6">
        <div className="grid size-32 place-items-center rounded-full border-[14px] border-primary text-center">
          <span className="text-xs text-muted-foreground">
            {t("preview.spent")}
            <br />
            <strong className="text-base text-foreground">$1,240</strong>
          </span>
        </div>
        <div>
          <p className="font-black">{t("preview.monthlyBudget")}</p>
          <p className="mt-1 text-sm text-muted-foreground">$1,240 {t("preview.of")} $2,000</p>
        </div>
      </div>
      <div className="mt-7 grid gap-5">
        {items.map(([label, percentage, className]) => (
          <div key={label}>
            <div className="flex justify-between text-sm font-bold">
              <span>{label}</span>
              <span>{percentage}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
              <div className={cn("h-full rounded-full", className)} style={{ width: percentage }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BillsPreview({ t }: { t: ReturnType<typeof useTranslations> }) {
  const locale = useLocale();
  const weekdayFormatter = new Intl.DateTimeFormat(locale, {
    weekday: "narrow",
    timeZone: "UTC",
  });
  const weekdays = [10, 11, 12, 13, 14, 15, 16].map((day) =>
    weekdayFormatter.format(new Date(Date.UTC(2026, 7, day))),
  );

  return (
    <div className="pt-7">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-black">{t("preview.august")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("preview.pendingBills")}</p>
        </div>
        <CalendarDays className="size-5 text-muted-foreground" />
      </div>
      <div className="mt-6 grid grid-cols-7 gap-2 text-center text-xs text-muted-foreground">
        {weekdays.map((day, index) => (
          <span key={index}>{day}</span>
        ))}
        {[10, 11, 12, 13, 14, 15, 16].map((day) => (
          <span
            key={day}
            className={cn(
              "grid aspect-square place-items-center rounded-xl",
              day === 12 && "bg-primary text-primary-foreground font-bold",
            )}
          >
            {day}
          </span>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between rounded-2xl border border-border p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-secondary">
            <ReceiptText className="size-4" />
          </span>
          <div>
            <p className="text-sm font-bold">{t("preview.internet")}</p>
            <p className="text-xs text-muted-foreground">{t("preview.dueToday")}</p>
          </div>
        </div>
        <span className="font-bold text-destructive">C$ 1,450</span>
      </div>
    </div>
  );
}
