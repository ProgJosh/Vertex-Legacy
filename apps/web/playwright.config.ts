import { defineConfig, devices } from "@playwright/test";

const systemChrome = process.env.PLAYWRIGHT_CHROME_PATH ??
  (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : undefined);
const e2eWebOrigin = "http://127.0.0.1:3100";
const e2eApiOrigin = "http://127.0.0.1:4100";

export default defineConfig({
  testDir: "./tests",
  // Next/Turbopack compiles routes lazily in the local test server. Parallel
  // browser projects can all trigger cold compilation at once and time out even
  // though the routes become healthy moments later.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: e2eWebOrigin,
    trace: "retain-on-failure",
    ...(systemChrome ? { launchOptions: { executablePath: systemChrome } } : {}),
  },
  webServer: [
    {
      command: "corepack pnpm --filter @vertex/api dev",
      url: e2eApiOrigin + "/v1/health",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        AUTH_PROVIDER: "mock",
        PAYMENT_PROVIDER: "mock",
        PAYOUT_PROVIDER: "mock",
        KYC_PROVIDER: "mock",
        PORT: "4100",
        API_PORT: "4100",
      },
    },
    {
      command: "corepack pnpm dev --port 3100",
      url: e2eWebOrigin,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        ...process.env,
        AUTH_PROVIDER: "mock",
        APP_BASE_URL: e2eWebOrigin,
        WEB_ORIGIN: e2eWebOrigin,
        INTERNAL_API_URL: e2eApiOrigin + "/v1",
        NEXT_PUBLIC_API_URL: e2eApiOrigin + "/v1",
      },
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
