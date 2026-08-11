"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHousehold } from "@/hooks/useHousehold";

export function HouseholdPicker() {
  const t = useTranslations("household.picker");
  const { memberships, selectHousehold } = useHousehold();

  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-secondary/70 px-4 py-8 sm:p-8">
      <Card className="w-full max-w-md rounded-[2rem] border-0 shadow-raised">
        <CardHeader className="gap-2 p-6 pb-5 sm:p-8 sm:pb-6">
          <CardTitle className="text-3xl font-black leading-none tracking-tight">
            {t("title")}
          </CardTitle>
          <CardDescription className="text-base leading-relaxed">{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-6 pt-0 sm:px-8 sm:pb-8">
          {memberships.map((m) => (
            <Button
              key={m.householdId}
              variant="outline"
              className="h-auto min-h-12 justify-between px-5 py-3 text-left"
              onClick={() => selectHousehold(m.householdId)}
            >
              {m.household.name}
              <span className="text-muted-foreground">{t("select")}</span>
            </Button>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
