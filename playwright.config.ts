import { defineConfig, devices } from '@playwright/test';

/**
 * E2E configuration.
 *
 * Runs against `astro preview` (workerd) rather than the Vite dev server, so
 * the tests exercise the real build output, the real CSP, and the real
 * middleware headers. Testing the dev server would miss every one of those.
 *
 * The browser is the cached chromium-headless-shell at the revision pinned in
 * package.json, so no download is needed.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: 'http://127.0.0.1:4321',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      // A small Android phone: the audience that matters most, arriving from
      // Instagram on a metered connection.
      use: { ...devices['Pixel 5'] },
    },
  ],

  webServer: {
    // `wrangler dev`, not `astro preview`: the preview server daemonises, so
    // its foreground process exits immediately and Playwright treats that as a
    // crash. wrangler runs the real build output in workerd with real
    // bindings, which is also closer to production than the Vite dev server.
    command: 'npx wrangler dev --port 4321 --ip 127.0.0.1',
    url: 'http://127.0.0.1:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
