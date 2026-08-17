"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdCommands } from "@/hooks/useHouseholdCommands";
import { useCountries } from "@/hooks/useCountries";
import { useCurrencies } from "@/hooks/useCurrencies";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function HouseholdSwitcher() {
  const t = useTranslations("household.switcher");
  const { householdId, householdName, memberships, selectHousehold } = useHousehold();
  const [open, setOpen] = useState(false);

  if (memberships.length < 2 || !householdId || !householdName) return null;

  return (
    <div className="border-b bg-background px-4 py-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" className="w-full justify-between px-2 font-semibold">
            {householdName}
            <span className="text-muted-foreground">{t("change")}</span>
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {memberships.map((membership) => (
              <Button
                key={membership.householdId}
                variant={membership.householdId === householdId ? "secondary" : "outline"}
                className="justify-between"
                onClick={() => {
                  setOpen(false);
                  selectHousehold(membership.householdId);
                }}
              >
                {membership.household.name}
                {membership.householdId === householdId ? t("active") : null}
              </Button>
            ))}
          </div>
          <HouseholdActions onComplete={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HouseholdActions({ onComplete }: { onComplete: () => void }) {
  const t = useTranslations("household.switcher");
  const locale = useLocale();
  const { selectHousehold } = useHousehold();
  const { create, accept } = useHouseholdCommands();
  const countries = useCountries();
  const currencies = useCurrencies();
  const countryNames = new Intl.DisplayNames(locale, { type: "region" });
  const [mode, setMode] = useState<"create" | "join" | null>(null);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleCreate(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !displayName.trim() || !country || !currency) {
      setError(t("required"));
      return;
    }
    setPending(true);
    const result = await create({ name, displayName, country, baseCurrency: currency });
    setPending(false);
    if (!result.ok) {
      setError(t("createError"));
      return;
    }
    onComplete();
    selectHousehold(result.value.householdId);
  }

  async function handleJoin(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim()) {
      setError(t("required"));
      return;
    }
    setPending(true);
    const result = await accept(token);
    setPending(false);
    if (!result.ok) {
      setError(t("joinError"));
      return;
    }
    onComplete();
    if (result.value.householdId) selectHousehold(result.value.householdId);
  }

  if (!mode) {
    return (
      <div className="flex gap-2 border-t pt-4">
        <Button className="flex-1" variant="outline" onClick={() => setMode("create")}>
          {t("create")}
        </Button>
        <Button className="flex-1" variant="outline" onClick={() => setMode("join")}>
          {t("join")}
        </Button>
      </div>
    );
  }

  if (mode === "join") {
    return (
      <form onSubmit={handleJoin} className="flex flex-col gap-3 border-t pt-4">
        <Label htmlFor="switcher-invite-token">{t("inviteToken")}</Label>
        <Input
          id="switcher-invite-token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? t("joining") : t("join")}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleCreate} className="flex flex-col gap-3 border-t pt-4">
      <div className="grid gap-2">
        <Label htmlFor="switcher-household-name">{t("householdName")}</Label>
        <Input
          id="switcher-household-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="switcher-display-name">{t("displayName")}</Label>
        <Input
          id="switcher-display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>
      <Select value={country} onValueChange={setCountry}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("country")} />
        </SelectTrigger>
        <SelectContent>
          {(countries.data ?? []).map((item) => (
            <SelectItem key={item} value={item}>
              {countryNames.of(item) ?? item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={currency} onValueChange={setCurrency}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("currency")} />
        </SelectTrigger>
        <SelectContent>
          {(currencies.data ?? []).map((item) => (
            <SelectItem key={item.code} value={item.code}>
              {item.code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? t("creating") : t("create")}
      </Button>
    </form>
  );
}
