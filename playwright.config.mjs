import { defineConfig, devices } from "@playwright/test";

const ISOLATION_FLAG = process.env.BROWSER_CROSS_ORIGIN_ISOLATION === "1" ? " --cross-origin-isolation" : "";
const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "web/tests/browser",
  outputDir: "build/test/test-results",
  timeout: 180_000,
  expect: { timeout: 90_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "build/test/playwright-report" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Serve the same distribution under a subpath so tests exercise the
    // base-path resolution GitHub Pages uses for a project site
    // (/vapoursynth-rust-webassembly/), not just root hosting.
    command: `python3 tools/serve-browser.py --port 4173 --directory build${ISOLATION_FLAG}`,
    url: `${BASE_URL}/web/app/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
