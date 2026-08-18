"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pendingInvitePath } from "@/lib/pending-invite";
import { useSession } from "@/hooks/useSession";
import { useCountries } from "@/hooks/useCountries";
import { useCurrencies } from "@/hooks/useCurrencies";
import { getPasswordStrength } from "@/lib/auth/flows";
import { useAuthCommands } from "@/hooks/useAuthCommands";
import { useHouseholdCommands } from "@/hooks/useHouseholdCommands";

type Step = "credentials" | "household" | "check-email";

export default function SignupPage() {
  const router = useRouter();
  const locale = useLocale();
  const { session, loading } = useSession();
  const { signup } = useAuthCommands();
  const { create: createHousehold } = useHouseholdCommands();
  const t = useTranslations("auth.signup");
  const tErrors = useTranslations("auth.errors");

  const [step, setStep] = useState<Step>("credentials");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [credentialsPending, setCredentialsPending] = useState(false);

  const [householdError, setHouseholdError] = useState<string | null>(null);
  const [householdPending, setHouseholdPending] = useState(false);

  const countries = useCountries({ enabled: !!session });
  const currencies = useCurrencies({ enabled: !!session });
  const countryNames = new Intl.DisplayNames(locale, { type: "region" });

  useEffect(() => {
    if (!loading && session && step === "credentials") {
      // An invite in progress beats the default destination, mirroring the
      // submit handler below — both peek so they can't clobber each other.
      router.replace(pendingInvitePath() ?? "/balances");
    }
  }, [loading, session, step, router]);

  async function handleCredentialsSubmit(formData: FormData) {
    setCredentialsError(null);
    setCredentialsPending(true);

    const name = String(formData.get("displayName") ?? "");
    const email = String(formData.get("email") ?? "");
    const pw = String(formData.get("password") ?? "");
    const result = await signup({ displayName: name, email, password: pw });

    setCredentialsPending(false);
    if (!result.ok) {
      setCredentialsError(result.errorKey);
      return;
    }
    if (result.value.redirectTo) {
      router.replace(result.value.redirectTo);
      return;
    }
    setDisplayName(name.trim());
    setStep(result.value.nextStep);
  }

  async function handleHouseholdSubmit(formData: FormData) {
    setHouseholdError(null);
    setHouseholdPending(true);

    const name = String(formData.get("householdName") ?? "").trim();
    const country = String(formData.get("country") ?? "");
    const baseCurrency = String(formData.get("baseCurrency") ?? "");

    const result = await createHousehold({
      name,
      country,
      baseCurrency,
      displayName,
    });

    setHouseholdPending(false);
    if (!result.ok) {
      setHouseholdError(result.errorKey);
      return;
    }
    router.replace("/balances");
  }

  if (step === "check-email") {
    return (
      <Card className="w-full rounded-[2rem] border-0 shadow-raised">
        <CardHeader className="gap-2 p-6 sm:p-8">
          <CardTitle className="text-3xl font-black leading-none tracking-tight">
            {t("checkEmailTitle")}
          </CardTitle>
          <CardDescription className="text-base leading-relaxed">
            {t("checkEmailBody")}
          </CardDescription>
        </CardHeader>
        <CardFooter className="px-6 pb-6 pt-0 sm:px-8 sm:pb-8">
          <Link
            href="/login"
            className="text-sm font-semibold text-foreground underline-offset-4 hover:underline"
          >
            {t("loginLink")}
          </Link>
        </CardFooter>
      </Card>
    );
  }

  if (step === "household") {
    return (
      <Card className="w-full rounded-[2rem] border-0 shadow-raised">
        <CardHeader className="gap-2 p-6 pb-5 sm:p-8 sm:pb-6">
          <CardTitle className="text-3xl font-black leading-none tracking-tight">
            {t("title")}
          </CardTitle>
          <CardDescription className="text-base leading-relaxed">
            {t("subtitleHousehold")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 pt-0 sm:px-8">
          <form action={handleHouseholdSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="householdName">{t("householdName")}</Label>
              <Input
                id="householdName"
                name="householdName"
                required
                placeholder={t("householdNamePlaceholder")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="country">{t("country")}</Label>
              <Select name="country" required>
                <SelectTrigger id="country" className="w-full">
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
              <Label htmlFor="baseCurrency">{t("baseCurrency")}</Label>
              <Select name="baseCurrency" required>
                <SelectTrigger id="baseCurrency" className="w-full">
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
            {householdError ? (
              <p role="alert" className="text-sm text-destructive">
                {tErrors(householdError)}
              </p>
            ) : null}
            <Button type="submit" size="lg" className="mt-1 w-full" disabled={householdPending}>
              {householdPending ? t("creatingHousehold") : t("createHousehold")}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  const strength = getPasswordStrength(password);

  return (
    <Card className="w-full rounded-[2rem] border-0 shadow-raised">
      <CardHeader className="gap-2 p-6 pb-5 sm:p-8 sm:pb-6">
        <CardTitle className="text-3xl font-black leading-none tracking-tight">
          {t("title")}
        </CardTitle>
        <CardDescription className="text-base leading-relaxed">
          {t("subtitleCredentials")}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 pt-0 sm:px-8">
        <form action={handleCredentialsSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="displayName">{t("displayName")}</Label>
            <Input id="displayName" name="displayName" required autoComplete="name" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {strength ? t(`passwordStrength.${strength}`) : t("passwordHint")}
            </p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t.rich("consentNotice", {
              terms: (chunks) => (
                <Link
                  href="/terms"
                  target="_blank"
                  className="font-semibold text-foreground underline-offset-4 hover:underline"
                >
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link
                  href="/privacy"
                  target="_blank"
                  className="font-semibold text-foreground underline-offset-4 hover:underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
          {credentialsError ? (
            <p role="alert" className="text-sm text-destructive">
              {tErrors(credentialsError)}
            </p>
          ) : null}
          <Button type="submit" size="lg" className="mt-1 w-full" disabled={credentialsPending}>
            {credentialsPending ? t("submitting") : t("continue")}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="p-6 pt-0 text-sm text-muted-foreground sm:px-8 sm:pb-8">
        {t("haveAccount")}{" "}
        <Link
          href="/login"
          className="font-semibold text-foreground underline-offset-4 hover:underline"
        >
          {t("loginLink")}
        </Link>
      </CardFooter>
    </Card>
  );
}
