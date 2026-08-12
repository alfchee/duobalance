import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const publicRoutes = ["/login", "/signup", "/forgot-password", "/reset-password"] as const;
const protectedRoutes = [
  "/balances",
  "/transactions",
  "/budget",
  "/bills",
  "/settings",
  "/settings/categories",
  "/settings/rules",
] as const;

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

test.describe("public authentication routes", () => {
  for (const route of publicRoutes) {
    test(`${route} is reachable`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${route.replace("/", "\\/")}$`));
    });
  }
});

test.describe("protected route guards", () => {
  for (const route of protectedRoutes) {
    test(`${route} redirects an anonymous visitor to login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
    });
  }
});

test("authentication UI has no detectable accessibility violations @a11y", async ({ page }) => {
  await page.goto("/login");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("authentication UI supports keyboard navigation and a visible focus indicator @a11y", async ({
  page,
}) => {
  await page.goto("/login");
  await page.keyboard.press("Tab");
  const brandLink = page.getByRole("link", { name: /duobalance/i });
  await expect(brandLink).toBeFocused();
  await expect(brandLink).toHaveCSS("box-shadow", /rgb/);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel(/email/i)).toBeFocused();
});

for (const viewport of viewports) {
  test(`login renders at the ${viewport.name} breakpoint @visual`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await expect(page.getByRole("main")).toBeVisible();
    await page.screenshot({
      path: `test-results/ui-validation/${test.info().project.name}-login-${viewport.name}.png`,
      fullPage: true,
    });
  });
}
