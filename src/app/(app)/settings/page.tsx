"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { useHousehold } from "@/hooks/useHousehold";
import { useAuthCommands } from "@/hooks/useAuthCommands";
import { LocaleSwitcher } from "./locale-switcher";
import { NumberFormatSwitcher } from "./number-format-switcher";
import { MembersSection } from "./members-section";
import { FxRatesSection } from "./fx-rates-section";
import { FxOverridesSection } from "./fx-overrides-section";
import { InstallSection } from "@/components/pwa/install-section";
import { PushNotificationsSection } from "@/components/pwa/push-notifications-section";
import { ExportSection } from "@/components/household/export-section";

export default function SettingsPage() {
  const router = useRouter();
  const t = useTranslations("settings");
  const { user } = useSession();
  const { householdName, role, baseCurrency } = useHousehold();
  const { logout } = useAuthCommands();

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <div
          aria-label={t("profileAvatar", { email: user?.email ?? "" })}
          className="flex size-10 items-center justify-center rounded-full border bg-secondary text-sm font-semibold"
        >
          {(user?.email?.[0] ?? "?").toUpperCase()}
        </div>
      </header>

      <SettingsGroup title={t("groups.household")}>
        <div className="space-y-1 px-4 py-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t("signedInAs")}</p>
          <p>{user?.email}</p>
          {householdName ? (
            <p>
              {t("household")}: {householdName}
              {role ? ` · ${t(`role.${role}`)}` : null}
            </p>
          ) : null}
        </div>
        <SettingsFieldRow
          title={t("baseCurrency.title")}
          description={
            baseCurrency
              ? t("baseCurrency.value", { currency: baseCurrency })
              : t("baseCurrency.unavailable")
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("members.title")}>
        <MembersSection embedded />
      </SettingsGroup>

      <SettingsGroup title={t("groups.preferences")}>
        <div className="border-b px-4 py-4">
          <LocaleSwitcher />
        </div>
        <div className="border-b px-4 py-4">
          <NumberFormatSwitcher />
        </div>
        <div className="px-4 py-4">
          <InstallSection />
        </div>
        <PushNotificationsSection />
      </SettingsGroup>

      <SettingsGroup title={t("groups.configuration")}>
        <SettingsLinkRow
          href="/settings/categories"
          title={t("navigation.categories.title")}
          description={t("navigation.categories.description")}
        />
        <SettingsLinkRow
          href="/settings/rules"
          title={t("navigation.rules.title")}
          description={t("navigation.rules.description")}
        />
      </SettingsGroup>

      <FxRatesSection />

      <FxOverridesSection />

      <SettingsGroup title={t("groups.data")}>
        <ExportSection />
      </SettingsGroup>

      <Button
        variant="outline"
        className="w-full text-destructive hover:text-destructive"
        onClick={handleLogout}
      >
        {t("logout")}
      </Button>
    </main>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-ring">
      <h2 className="border-b bg-secondary px-4 py-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function SettingsLinkRow({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-16 items-center justify-between gap-4 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function SettingsFieldRow({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-16 items-center px-4 py-3">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
