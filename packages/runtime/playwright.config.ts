import { defineConfig, devices } from "@playwright/test";

const VITE_PORT = Number(process.env["LUMENCAST_DEV_PORT"] ?? 5173);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: process.env["CI"] ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${VITE_PORT}`,
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Local-dev escape hatch : run against a system browser
        // (`chrome` / `msedge`) when the playwright-managed chromium
        // download is unavailable. CI leaves this unset.
        ...(process.env["PW_BROWSER_CHANNEL"]
          ? { channel: process.env["PW_BROWSER_CHANNEL"] }
          : {}),
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite --port ${VITE_PORT} --strictPort`,
    url: `http://localhost:${VITE_PORT}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
