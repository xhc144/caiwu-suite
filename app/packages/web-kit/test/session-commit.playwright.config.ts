import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'session-commit.browser.spec.ts',
  outputDir: '/tmp/caiwu-session-commit-playwright',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4328',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
  webServer: {
    command: 'node --import tsx packages/web-kit/test/browser/server.ts',
    cwd: process.cwd(),
    url: 'http://127.0.0.1:4328/packages/web-kit/test/browser/session-commit.html',
    reuseExistingServer: false,
  },
});
