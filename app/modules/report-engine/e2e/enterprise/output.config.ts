import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'output.spec.ts',
  retries: 0,
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: {
    locale: 'zh-CN',
    viewport: { width: 1366, height: 768 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium',
    },
  },
});
