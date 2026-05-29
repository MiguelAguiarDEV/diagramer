import { defineConfig, devices } from "@playwright/test";

// The binary is built and launched fresh against a throwaway data dir so runs
// are deterministic. We use go run so there's no separate build step to keep
// in sync; the frontend is embedded at compile time.
const PORT = 7799;
const DATA_DIR = "/tmp/diagramer-e2e-data";

export default defineConfig({
  testDir: ".",
  // demo.spec.ts only generates marketing screenshots (no assertions); keep it
  // out of the regular suite so it doesn't add time for zero verification.
  testIgnore: ["demo.spec.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1200, height: 800 },
    // Allow pointing at a pre-installed Chromium (e.g. CI/sandbox where the
    // Playwright CDN is blocked). Unset on a normal dev machine.
    launchOptions: process.env.PW_CHROMIUM
      ? { executablePath: process.env.PW_CHROMIUM }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `rm -rf ${DATA_DIR} && cd .. && go run ./cmd/diagramer -addr 127.0.0.1:${PORT} -data ${DATA_DIR}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
