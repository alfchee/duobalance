"use client";

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillingGate } from "./billing-gate";

// The UI half of the #262 acceptance criterion: with the flag off, no
// billing surface renders. (Route-level 404s are covered by the webhook and
// debug route tests; the accessor default is covered by enabled.test.ts.)

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.BILLING_ENABLED;
  delete process.env.NEXT_PUBLIC_BILLING_ENABLED;
});

describe("BillingGate (#262)", () => {
  it("renders nothing while the flag is off", () => {
    render(
      <BillingGate>
        <button type="button">Upgrade to Plus</button>
      </BillingGate>,
    );
    expect(screen.queryByRole("button", { name: "Upgrade to Plus" })).toBeNull();
  });

  it("renders its children once the flag is on", () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_ENABLED", "1");
    render(
      <BillingGate>
        <button type="button">Upgrade to Plus</button>
      </BillingGate>,
    );
    expect(screen.queryByRole("button", { name: "Upgrade to Plus" })).not.toBeNull();
  });
});
