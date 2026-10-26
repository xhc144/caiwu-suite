import { defineConfig, devices } from '@playwright/test';

/** 独立共享层验收，不依赖本波三套法定模板或其它新页面。 */
export default defineConfig({
  testDir: '.',
  testMatch: 'retrieval.e2e.spec.ts',
  retries: 0,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
});
