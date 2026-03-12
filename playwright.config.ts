// playwright.config.ts
// Place this in the project root

import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect:  { timeout: 5_000 },

  // Fail fast in CI, run all locally
  fullyParallel: true,
  forbidOnly:    !!process.env.CI,
  retries:       process.env.CI ? 2 : 0,
  workers:       process.env.CI ? 1 : undefined,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    ...(process.env.CI ? [['github'] as ['github']] : []),
  ],

  use: {
    baseURL:           process.env.BASE_URL ?? 'http://localhost:4200',
    trace:             'on-first-retry',
    screenshot:        'only-on-failure',
    video:             'retain-on-failure',
    actionTimeout:     10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    // ── Auth setup (runs once before all tests) ──────────────────────────────
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },

    // ── Desktop browsers ─────────────────────────────────────────────────────
    {
      name:        'chromium',
      use:         { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
    {
      name:        'firefox',
      use:         { ...devices['Desktop Firefox'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
    {
      name:        'webkit',
      use:         { ...devices['Desktop Safari'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },

    // ── Mobile viewports ─────────────────────────────────────────────────────
    {
      name:        'Mobile Chrome',
      use:         { ...devices['Pixel 7'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
    {
      name:        'Mobile Safari',
      use:         { ...devices['iPhone 14'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],

  // Start dev server if not in CI
  webServer: process.env.CI ? undefined : {
    command: 'npm run start',
    url:     'http://localhost:4200',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// e2e/global-setup.ts
// Logs in once and saves auth state so tests don't re-login

// import { chromium, FullConfig } from '@playwright/test';
//
// export default async function globalSetup(config: FullConfig) {
//   const { baseURL } = config.projects[0].use;
//   const browser = await chromium.launch();
//   const page    = await browser.newPage();
//
//   await page.goto(`${baseURL}/login`);
//   await page.getByTestId('login-username').fill(process.env.E2E_USERNAME!);
//   await page.getByTestId('login-password').fill(process.env.E2E_PASSWORD!);
//   await page.getByTestId('login-submit').click();
//   await page.waitForURL('**/dashboard');
//
//   // Save auth state
//   await page.context().storageState({ path: 'e2e/.auth/user.json' });
//   await browser.close();
// }
