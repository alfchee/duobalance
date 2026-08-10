import { afterEach, describe, expect, it, vi } from "vitest";
import { isIOS, isStandalone } from "./pwa";

describe("isStandalone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
    Reflect.deleteProperty(navigator, "standalone");
  });

  it("recognizes display-mode standalone", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });

    expect(isStandalone()).toBe(true);
  });

  it("recognizes iOS standalone mode", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });

    expect(isStandalone()).toBe(true);
  });
});

describe("isIOS", () => {
  it("recognizes iPhone user agents", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    );

    expect(isIOS()).toBe(true);
  });
});
