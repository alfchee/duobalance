"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/hooks/useSession";
import { useCountries } from "@/hooks/useCountries";
import { useCurrencies } from "@/hooks/useCurrencies";
import { useHouseholdCommands } from "@/hooks/useHouseholdCommands";
import { useHousehold } from "@/hooks/useHousehold";
import { detectLocationDefaults, getCountryDefaultCurrency } from "@/lib/household/defaults";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Shown instead of a dead-end "We couldn't find a household for your account"
// paragraph when:
//   - the authenticated user has zero household_members rows, AND
//   - they're not mid picker (needsPicker is only true for 2+ rows).
//
// Two paths match this UX: the sign-up flow without a pre-existing household
// (e.g. user signed up but skipped or failed the in-signup household create
// step because they had to confirm email first) AND a brand-new invitee who
// signed up from /accept-invite but lost the pending-invite session state.
//
// Both flows converge here so the user never sees a screen with no CTA.
export function HouseholdOnboarding() {
  const t = useTranslations("household.onboarding");
  const tErrors = useTranslations("household.onboarding.errors");
  const tInviteErrors = useTranslations("household.onboarding.errorsInvite");
  const locale = useLocale();
  const router = useRouter();
  const { session } = useSession();
  const { selectHousehold } = useHousehold();
  const { create: createHousehold, accept: acceptInvite } = useHouseholdCommands();

  const countries = useCountries({ enabled: !!session });
  const currencies = useCurrencies({ enabled: !!session });
  const countryNames = new Intl.DisplayNames(locale, { type: "region" });

  const [displayName, setDisplayName] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [baseCurrency, setBaseCurrency] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);

  const [inviteToken, setInviteToken] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitePending, setInvitePending] = useState(false);

  useEffect(() => {
    if (!countries.data || !currencies.data || country) return;
    const currencyCodes = currencies.data.map((c) => c.code);
    const defaults = detectLocationDefaults(countries.data, currencyCodes);
    if (defaults.country) setCountry(defaults.country);
    if (defaults.baseCurrency) setBaseCurrency(defaults.baseCurrency);
  }, [countries.data, currencies.data, country]);

  function handleCountrySelect(val: string) {
    const newCountry = val || null;
    setCountry(newCountry);
    if (newCountry) {
      const suggested = getCountryDefaultCurrency(newCountry);
      const currencyCodes = currencies.data?.map((c) => c.code) ?? [];
      if (currencyCodes.includes(suggested)) {
        setBaseCurrency(suggested);
      }
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);

    const displayNameTrim = displayName.trim();
    const householdNameTrim = householdName.trim();
    if (!displayNameTrim) {
      setCreateError("displayNameRequired");
      return;
    }
    if (!householdNameTrim) {
      setCreateError("householdNameRequired");
      return;
    }
    if (!country) {
      setCreateError("countryRequired");
      return;
    }
    if (!baseCurrency) {
      setCreateError("baseCurrencyRequired");
      return;
    }

    setCreatePending(true);
    const result = await createHousehold({
      name: householdNameTrim,
      country,
      baseCurrency,
      displayName: displayNameTrim,
    });
    setCreatePending(false);

    if (!result.ok) {
      setCreateError(result.errorKey);
      return;
    }
    selectHousehold(result.value.householdId);
    router.replace("/balances");
  }

  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInviteError(null);
    const token = inviteToken.trim();
    if (!token) {
      setInviteError(tInviteErrors("tokenRequired"));
      return;
    }

    setInvitePending(true);
    const result = await acceptInvite(token);
    setInvitePending(false);

    if (!result.ok) {
      setInviteError(
        result.errorKey === "generic" ? tErrors("generic") : tInviteErrors(result.errorKey),
      );
      return;
    }
    if (result.value.householdId) selectHousehold(result.value.householdId);
    router.replace("/balances");
  }

  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-secondary/70 px-4 py-8 sm:p-8">
      <Card className="w-full max-w-md rounded-[2rem] border-0 shadow-raised">
        <CardHeader className="gap-2 p-6 pb-5 sm:p-8 sm:pb-6">
          <CardTitle className="text-3xl font-black leading-none tracking-tight">
            {t("title")}
          </CardTitle>
          <CardDescription className="text-base leading-relaxed">{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="p-6 pt-0 sm:px-8 sm:pb-8">
          <Tabs defaultValue="create" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="create">{t("tabCreate")}</TabsTrigger>
              <TabsTrigger value="invite">{t("tabInvite")}</TabsTrigger>
            </TabsList>
            <TabsContent value="create">
              <form onSubmit={handleCreate} className="mt-5 flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="onboarding-displayName">{t("displayName")}</Label>
                  <Input
                    id="onboarding-displayName"
                    name="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t("displayNamePlaceholder")}
                    autoComplete="name"
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="onboarding-householdName">{t("householdName")}</Label>
                  <Input
                    id="onboarding-householdName"
                    name="householdName"
                    value={householdName}
                    onChange={(e) => setHouseholdName(e.target.value)}
                    placeholder={t("householdNamePlaceholder")}
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="onboarding-country">{t("country")}</Label>
                  <Select value={country ?? ""} onValueChange={handleCountrySelect} required>
                    <SelectTrigger id="onboarding-country" className="w-full">
                      <SelectValue placeholder={t("countryPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(countries.data ?? []).map((code) => (
                        <SelectItem key={code} value={code}>
                          {countryNames.of(code) ?? code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="onboarding-baseCurrency">{t("baseCurrency")}</Label>
                  <Select
                    value={baseCurrency ?? ""}
                    onValueChange={(v) => setBaseCurrency(v || null)}
                    required
                  >
                    <SelectTrigger id="onboarding-baseCurrency" className="w-full">
                      <SelectValue placeholder={t("baseCurrencyPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(currencies.data ?? []).map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.code} — {c.name_en}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {createError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {tErrors(createError)}
                  </p>
                ) : null}
                <Button type="submit" size="lg" className="mt-1 w-full" disabled={createPending}>
                  {createPending ? t("creating") : t("createButton")}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="invite">
              <form onSubmit={handleInvite} className="mt-5 flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="onboarding-inviteToken">{t("inviteToken")}</Label>
                  <Input
                    id="onboarding-inviteToken"
                    name="inviteToken"
                    value={inviteToken}
                    onChange={(e) => setInviteToken(e.target.value)}
                    placeholder={t("inviteTokenPlaceholder")}
                    required
                  />
                </div>
                {inviteError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {inviteError}
                  </p>
                ) : null}
                <Button type="submit" size="lg" className="mt-1 w-full" disabled={invitePending}>
                  {invitePending ? t("inviteAccepting") : t("inviteAccept")}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </main>
  );
}
