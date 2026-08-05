"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHousehold } from "@/hooks/useHousehold";

export function HouseholdPicker() {
  const t = useTranslations("household.picker");
  const { memberships, selectHousehold } = useHousehold();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {memberships.map((m) => (
            <Button
              key={m.householdId}
              variant="outline"
              className="justify-between"
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
