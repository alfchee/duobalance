"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useHousehold } from "@/hooks/useHousehold";
import { LocaleSwitcher } from "./locale-switcher";
import { MembersSection } from "./members-section";
import { FxRatesSection } from "./fx-rates-section";
import { FxOverridesSection } from "./fx-overrides-section";
import { CategoriesSection } from "@/components/categories/categories-section";
import { RulesSection } from "@/components/categories/rules-section";
import { InstallSection } from "@/components/pwa/install-section";

export default function SettingsPage() {
  const router = useRouter();
  const t = useTranslations("settings");
  const { user } = useSession();
  const { householdName, role } = useHousehold();

  async function handleLogout() {
    const supabase = createSupabaseBrowser();
    await supabase?.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t("signedInAs")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>{user?.email}</p>
          {householdName ? (
            <p>
              {t("household")}: {householdName}
              {role ? ` · ${t(`role.${role}`)}` : null}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <LocaleSwitcher />

      <InstallSection />

      <MembersSection />

      <FxRatesSection />

      <FxOverridesSection />

      <CategoriesSection />

      <RulesSection />

      <Button variant="outline" className="mt-4" onClick={handleLogout}>
        {t("logout")}
      </Button>
    </main>
  );
}
