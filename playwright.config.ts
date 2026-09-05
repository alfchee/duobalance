import { defineConfig, devices } from "@playwright/test";

const port = 3101;
const defaultBaseURL = `http://127.0.0.1:${port}`;
// #161: staging gate — run the suite unchanged against a deployed Worker.
//
// Local:   npm run test:e2e                         → builds + starts 127.0.0.1:3101
// Staging: STAGING_URL=https://staging.duobalanceapp.com npm run test:e2e → no build, hits staging
//          STAGING_URL can also be a *.workers.dev preview URL.
//          PLAYWRIGHT_BASE_URL / E2E_BASE_URL are compat aliases (CI + docs).
//
// The issue's AC is explicit: "no test modified to accommodate the new host".
// That is enforced by keeping every `page.goto('/login')` relative — only baseURL
// changes. When a remote baseURL is set, webServer is disabled so CI does not
// waste time building a local Next server that will never be used.
const remoteBaseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.STAGING_URL ??
  process.env.E2E_BASE_URL ??
  process.env.E2E_URL;
const baseURL = remoteBaseURL?.trim() ? remoteBaseURL.trim().replace(/\/$/, "") : defaultBaseURL;
const isRemote = Boolean(remoteBaseURL?.trim());

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: isRemote
    ? undefined
    : {
        command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
