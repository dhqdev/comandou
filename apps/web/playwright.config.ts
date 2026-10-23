import { defineConfig, devices } from '@playwright/test';

/**
 * E2E contra uma stack em execução (docker compose ou dev servers).
 * BASE_URL deve apontar para o host de um restaurante provisionado, ex.:
 *   E2E_BASE_URL=http://demo.comandou.localhost:8080 E2E_EMAIL=... E2E_PASSWORD=... pnpm e2e
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  // No CI, uma nova tentativa cobre animações lentas do runner (o teste só passa se repetir limpo).
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://demo.comandou.localhost:5173',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
