import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    // Every engine words aborts and blocked requests differently, so the fixture runs in all three.
    // Opt-in locally: Playwright's Firefox does not start on every macOS version.
    ...(process.env.CI || process.env.E2E_ALL_BROWSERS
      ? [
          { name: 'firefox', use: devices['Desktop Firefox'], testMatch: 'fixtures.spec.ts' },
          { name: 'webkit', use: devices['Desktop Safari'], testMatch: 'fixtures.spec.ts' },
        ]
      : []),
  ],
  webServer: {
    command: 'node e2e/server.ts',
    cwd: '..',
    url: `http://localhost:${PORT}/`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
  },
});
