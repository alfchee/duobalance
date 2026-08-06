"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
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
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { getAuthErrorKey } from "@/lib/supabase/auth-errors";
import { useSession } from "@/hooks/useSession";
import { useCountries } from "@/hooks/useCountries";
import { useCurrencies } from "@/hooks/useCurrencies";

type Step = "credentials" | "household" | "check-email";

function passwordStrength(password: string): "weak" | "fair" | "strong" | null {
  if (password.length === 0) return null;
  if (password.length < 8) return "weak";
  const varietyScore = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (password.length >= 12 && varietyScore >= 3) return "strong";
  if (varietyScore >= 2) return "fair";
  return "weak";
}

export default function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const { session, loading } = useSession();
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
      router.replace("/balances");
    }
  }, [loading, session, step, router]);

  async function handleCredentialsSubmit(formData: FormData) {
    setCredentialsError(null);
    setCredentialsPending(true);

    const name = String(formData.get("displayName") ?? "").trim();
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const pw = String(formData.get("password") ?? "");

    const supabase = createSupabaseBrowser();
    if (!supabase) {
      setCredentialsError("generic");
      setCredentialsPending(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password: pw,
      options: { data: { display_name: name } },
    });

    setCredentialsPending(false);

    if (error) {
      setCredentialsError(getAuthErrorKey(error));
      return;
    }

    // Preserve an invite flow: coming from /accept-invite/{token} via
    // ?next=, the account is created but no household — the invite's
    // accept_invite RPC attaches the user to the inviter's household. Only
    // skip household setup when we actually have a session; with email
    // confirmation pending the user falls through to check-email and picks
    // the invite back up from the accept page's login link after confirming.
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && data.session) {
      router.replace(next);
      return;
    }

    // Treat every successful response identically so the flow can't reveal
    // whether an email is already registered: existing emails return no
    // session, so they fall through to the same check-email step a brand-new
    // user sees. (Matches the neutral forgot-password flow.)
    setDisplayName(name);
    setStep(data.session ? "household" : "check-email");
  }

  async function handleHouseholdSubmit(formData: FormData) {
    setHouseholdError(null);
    setHouseholdPending(true);

    const name = String(formData.get("householdName") ?? "").trim();
    const country = String(formData.get("country") ?? "");
    const baseCurrency = String(formData.get("baseCurrency") ?? "");

    const supabase = createSupabaseBrowser();
    if (!supabase) {
      setHouseholdError("generic");
      setHouseholdPending(false);
      return;
    }

    const { error } = await supabase.rpc("create_household", {
      p_name: name,
      p_country: country,
      p_base_currency: baseCurrency,
      p_display_name: displayName,
    });

    setHouseholdPending(false);

    if (error) {
      console.error(error);
      setHouseholdError("generic");
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["households", "memberships"] });
    router.replace("/balances");
  }

  if (step === "check-email") {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("checkEmailTitle")}</CardTitle>
          <CardDescription>{t("checkEmailBody")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Link href="/login" className="text-sm text-primary hover:underline">
            {t("loginLink")}
          </Link>
        </CardFooter>
      </Card>
    );
  }

  if (step === "household") {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitleHousehold")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={handleHouseholdSubmit} className="flex flex-col gap-4">
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
            <Button type="submit" disabled={householdPending}>
              {householdPending ? t("creatingHousehold") : t("createHousehold")}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  const strength = passwordStrength(password);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitleCredentials")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleCredentialsSubmit} className="flex flex-col gap-4">
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
          {credentialsError ? (
            <p role="alert" className="text-sm text-destructive">
              {tErrors(credentialsError)}
            </p>
          ) : null}
          <Button type="submit" disabled={credentialsPending}>
            {credentialsPending ? t("submitting") : t("continue")}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link href="/login" className="text-primary hover:underline">
          {t("loginLink")}
        </Link>
      </CardFooter>
    </Card>
  );
}
